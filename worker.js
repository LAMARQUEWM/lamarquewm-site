
const stripeApi = "https://api.stripe.com/v1";

function errorResponse(message, status = 400) {
  return Response.json({ error: message }, { status });
}

async function loadCatalog(request, env) {
  if (!env.ASSETS) throw new Error("Catalogue indisponible");

  const url = new URL("/catalog.json", request.url);
  const response = await env.ASSETS.fetch(new Request(url));

  if (!response.ok) throw new Error("Catalogue introuvable");

  const catalog = await response.json();
  if (!Array.isArray(catalog)) {
    throw new Error("Catalogue invalide");
  }
  return catalog;
}

function variantLabel(variant) {
  if (!variant) return "";
  return Object.entries(variant)
    .filter(([key]) => key !== "qty")
    .map(([key, value]) => `${key} : ${value}`)
    .join(" / ");
}

async function stripeRequest(env, path, params, idempotencyKey) {
  const headers = {
    Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    "Content-Type": "application/x-www-form-urlencoded"
  };

  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  const response = await fetch(stripeApi + path, {
    method: "POST",
    headers,
    body: params.toString()
  });

  const data = await response.json();
  if (!response.ok) {
    console.error("Stripe error", response.status, data?.error?.type);
    throw new Error("Erreur Stripe");
  }
  return data;
}

async function verifyStripeSignature(payload, header, secret) {
  if (!header || !secret) return false;

  const timestamp = header.match(/(?:^|,)t=(\d+)/)?.[1];
  const signatures = [...header.matchAll(/(?:^|,)v1=([a-f0-9]+)/g)]
    .map(match => match[1]);

  if (!timestamp || !signatures.length) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}.${payload}`)
  );

  const expected = [...new Uint8Array(signature)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");

  return signatures.some(value => {
    if (value.length !== expected.length) return false;
    let difference = 0;
    for (let i = 0; i < expected.length; i++) {
      difference |= value.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    return difference === 0;
  });
}

async function handleWebhook(request, env) {
  if (!env.DB || !env.STRIPE_WEBHOOK_SECRET) {
    return errorResponse("Webhook non configuré", 503);
  }

  const payload = await request.text();
  const signature = request.headers.get("Stripe-Signature");

  if (!(await verifyStripeSignature(
    payload,
    signature,
    env.STRIPE_WEBHOOK_SECRET
  ))) {
    return errorResponse("Signature Stripe invalide", 400);
  }

  const event = JSON.parse(payload);

  if (event.type !== "checkout.session.completed" &&
      event.type !== "checkout.session.async_payment_succeeded") {
    return Response.json({ received: true });
  }

  const session = event.data?.object;

  if (!session?.id || session.payment_status !== "paid") {
    return Response.json({ received: true });
  }

  const order = await env.DB.prepare(
    "SELECT id, status, amount_total FROM orders WHERE stripe_session_id = ?"
  ).bind(session.id).first();

  if (!order) {
    console.error("Commande inconnue", session.id);
    return errorResponse("Commande inconnue", 500);
  }

  if (order.status !== "pending") {
    return Response.json({ received: true, already_processed: true });
  }

  if (Number(session.amount_total) !== Number(order.amount_total) ||
      session.currency !== "eur") {
    console.error("Montant de commande incohérent", order.id);
    return errorResponse("Montant incohérent", 500);
  }

  // La transition pending -> processing est atomique.
  // Elle évite de traiter deux fois le même paiement.
  const claimed = await env.DB.prepare(
    `UPDATE orders
     SET status = 'processing',
         customer_email = ?,
         customer_name = ?,
         paid_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'pending'
     RETURNING id`
  ).bind(
    session.customer_details?.email || session.customer_email || null,
    session.customer_details?.name || null,
    order.id
  ).first();

  if (!claimed) {
    return Response.json({ received: true, already_processed: true });
  }

  const items = await env.DB.prepare(
    `SELECT product_handle, variant_index, quantity
     FROM order_items WHERE order_id = ?`
  ).bind(order.id).all();

  try {
    const lines = items.results || [];

    if (!lines.length) throw new Error("Commande sans articles");

    // Vérification de tous les stocks avant la déduction.
    const checks = await Promise.all(lines.map(item =>
      env.DB.prepare(
        `SELECT stock FROM inventory
         WHERE product_handle = ? AND variant_index = ?`
      ).bind(item.product_handle, item.variant_index).first()
    ));

    if (checks.some((row, i) =>
      !row || Number(row.stock) < Number(lines[i].quantity)
    )) {
      await env.DB.prepare(
        "UPDATE orders SET status = 'stock_review' WHERE id = ?"
      ).bind(order.id).run();

      console.error("Stock insuffisant après paiement", order.id);
      return Response.json({ received: true, stock_review: true });
    }

    // Les mises à jour conditionnelles empêchent les stocks négatifs.
    const statements = lines.map(item =>
      env.DB.prepare(
        `UPDATE inventory
         SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP
         WHERE product_handle = ? AND variant_index = ?
           AND stock >= ?`
      ).bind(
        item.quantity,
        item.product_handle,
        item.variant_index,
        item.quantity
      )
    );

    const results = await env.DB.batch(statements);

    if (results.some(result => result.meta?.changes !== 1)) {
      await env.DB.prepare(
        "UPDATE orders SET status = 'stock_review' WHERE id = ?"
      ).bind(order.id).run();

      console.error("Stock à contrôler", order.id);
      return Response.json({ received: true, stock_review: true });
    }

    await env.DB.prepare(
      "UPDATE orders SET status = 'paid' WHERE id = ? AND status = 'processing'"
    ).bind(order.id).run();

    return Response.json({ received: true });
  } catch (error) {
    console.error("Traitement commande", order.id, error);

    await env.DB.prepare(
      "UPDATE orders SET status = 'stock_review' WHERE id = ? AND status = 'processing'"
    ).bind(order.id).run();

    return errorResponse("Traitement à vérifier", 500);
  }
}

async function createCheckout(request, env, url) {
  if (!env.DB || !env.STRIPE_SECRET_KEY ||
      !env.STRIPE_WEBHOOK_SECRET) {
    return errorResponse("Boutique en configuration", 503);
  }

  const body = await request.json();
  const items = body?.items;

  if (!Array.isArray(items) || !items.length || items.length > 30) {
    return errorResponse("Panier invalide");
  }

  const catalog = await loadCatalog(request, env);
  const grouped = new Map();

  for (const item of items) {
    if (!item || typeof item.handle !== "string" ||
        !Number.isInteger(item.variantIndex) ||
        !Number.isInteger(item.qty) ||
        item.qty < 1 || item.qty > 100) {
      return errorResponse("Article invalide");
    }

    const product = catalog.find(p => p.handle === item.handle);
    if (!product) return errorResponse("Produit introuvable");

    const variants = Array.isArray(product.variants)
      ? product.variants : [];

    if (variants.length
      ? !variants[item.variantIndex]
      : item.variantIndex !== -1) {
      return errorResponse("Variante invalide");
    }

    const key = JSON.stringify([item.handle, item.variantIndex]);
    const existing = grouped.get(key);

    if (existing) {
      existing.quantity += item.qty;
    } else {
      const price = Number(product.price);
      const cents = Math.round(price * 100);

      if (!Number.isFinite(price) || price <= 0 ||
          !Number.isSafeInteger(cents)) {
        return errorResponse("Prix invalide", 500);
      }

      grouped.set(key, {
        handle: item.handle,
        variantIndex: item.variantIndex,
        quantity: item.qty,
        title: product.title,
        label: variantLabel(variants[item.variantIndex]),
        amount: cents
      });
    }
  }

  const lines = [...grouped.values()];

  for (const line of lines) {
    if (line.quantity > 100) {
      return errorResponse("Quantité trop importante");
    }

    const inventory = await env.DB.prepare(
      `SELECT stock FROM inventory
       WHERE product_handle = ? AND variant_index = ?`
    ).bind(line.handle, line.variantIndex).first();

    if (!inventory) {
      return errorResponse("Stock non initialisé", 503);
    }

    if (Number(inventory.stock) < line.quantity) {
      return errorResponse(`Stock insuffisant : ${line.title}`);
    }
  }

  const total = lines.reduce(
    (sum, line) => sum + line.amount * line.quantity, 0
  );

  if (!Number.isSafeInteger(total) || total <= 0) {
    return errorResponse("Montant invalide");
  }

  const orderId = crypto.randomUUID();
  const params = new URLSearchParams();

  params.set("mode", "payment");
  params.set("client_reference_id", orderId);
  params.set("metadata[order_id]", orderId);
  params.set("success_url",
    `${url.origin}/?payment=success&session_id={CHECKOUT_SESSION_ID}`);
  params.set("cancel_url", `${url.origin}/?payment=cancel`);
  params.set("billing_address_collection", "required");

  // Les frais et modalités de livraison doivent être
  // configurés et validés avant la mise en production.
  lines.forEach((line, i) => {
    params.set(`line_items[${i}][price_data][currency]`, "eur");
    params.set(`line_items[${i}][price_data][unit_amount]`,
      String(line.amount));
    params.set(`line_items[${i}][price_data][product_data][name]`,
      line.label ? `${line.title} — ${line.label}` : line.title);
    params.set(`line_items[${i}][quantity]`, String(line.quantity));
  });

  const session = await stripeRequest(
    env,
    "/checkout/sessions",
    params,
    orderId
  );

  if (!session.id || !session.url) {
    return errorResponse("Session de paiement invalide", 502);
  }

  try {
    const statements = [
      env.DB.prepare(
        `INSERT INTO orders
         (id, stripe_session_id, amount_total, currency, status)
         VALUES (?, ?, ?, 'eur', 'pending')`
      ).bind(orderId, session.id, total)
    ];

    for (const line of lines) {
      statements.push(env.DB.prepare(
        `INSERT INTO order_items
         (order_id, product_handle, product_title,
          variant_index, variant_label, quantity, unit_price)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        orderId,
        line.handle,
        line.title,
        line.variantIndex,
        line.label,
        line.quantity,
        line.amount
      ));
    }

    await env.DB.batch(statements);
  } catch (error) {
    console.error("Enregistrement commande", error);

    // Empêcher l'utilisation d'une session non enregistrée.
    try {
      await stripeRequest(
        env,
        `/checkout/sessions/${encodeURIComponent(session.id)}/expire`,
        new URLSearchParams()
      );
    } catch (expireError) {
      console.error("Expiration session impossible", expireError);
    }

    return errorResponse("Commande non enregistrée", 500);
  }

  return Response.json({ url: session.url });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        message: "La Marque WM API fonctionne"
      });
    }

    if (url.pathname === "/api/db-status") {
      try {
        if (!env.DB) return errorResponse("D1 absente", 503);

        const result = await env.DB.prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table'
           AND name IN ('orders', 'order_items', 'inventory')`
        ).all();

        return Response.json({
          ok: true,
          database: true,
          tables: result.results.map(row => row.name)
        });
      } catch (error) {
        console.error(error);
        return errorResponse("Erreur D1", 500);
      }
    }

    if (url.pathname === "/api/stripe-status") {
      if (!env.STRIPE_SECRET_KEY) {
        return errorResponse("Clé Stripe absente", 503);
      }

      try {
        const response = await fetch(`${stripeApi}/account`, {
          headers: {
            Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`
          }
        });

        return Response.json({
          ok: response.ok,
          stripe: response.ok,
          message: response.ok
            ? "Connexion Stripe OK"
            : "Connexion Stripe refusée"
        }, { status: response.ok ? 200 : 502 });
      } catch {
        return errorResponse("Stripe indisponible", 502);
      }
    }

    if (url.pathname === "/api/stripe-webhook" &&
        request.method === "POST") {
      try {
        return await handleWebhook(request, env);
      } catch (error) {
        console.error("Webhook", error);
        return errorResponse("Erreur webhook", 500);
      }
    }

    if (url.pathname === "/api/create-checkout-session" &&
        request.method === "POST") {
      try {
        return await createCheckout(request, env, url);
      } catch (error) {
        console.error("Checkout", error);
        return errorResponse("Erreur de préparation du paiement", 500);
      }
    }

    if (url.pathname.startsWith("/api/")) {
      return errorResponse("Not found", 404);
    }

    return env.ASSETS.fetch(request);
  }
};
