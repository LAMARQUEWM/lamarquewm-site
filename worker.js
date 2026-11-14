
async function loadCatalog(request, env) {
  if (!env.ASSETS) {
    throw new Error("Catalogue indisponible");
  }

  const catalogUrl = new URL("/catalog.json", request.url);
  const response = await env.ASSETS.fetch(
    new Request(catalogUrl.toString())
  );

  if (!response.ok) {
    throw new Error("Impossible de charger le catalogue");
  }

  const catalog = await response.json();

  if (!Array.isArray(catalog)) {
    throw new Error("Format du catalogue invalide");
  }

  return catalog;
}

function errorResponse(message, status = 400) {
  return Response.json({ error: message }, { status });
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

    if (url.pathname === "/api/stripe-status") {
      try {
        if (!env.STRIPE_SECRET_KEY) {
          return errorResponse("Clé Stripe absente", 503);
        }

        const response = await fetch(
          "https://api.stripe.com/v1/account",
          {
            headers: {
              Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`
            }
          }
        );

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

    if (
      url.pathname === "/api/create-checkout-session" &&
      request.method === "POST"
    ) {
      try {
        if (!env.STRIPE_SECRET_KEY) {
          return errorResponse("Paiement indisponible", 503);
        }

        const body = await request.json();
        const items = body?.items;

        if (!Array.isArray(items) || items.length === 0 || items.length > 30) {
          return errorResponse("Panier invalide");
        }

        const catalog = await loadCatalog(request, env);
        const validated = [];
        const requestedQuantities = new Map();

        for (const item of items) {
          if (
            !item ||
            typeof item.handle !== "string" ||
            !Number.isInteger(item.variantIndex) ||
            !Number.isInteger(item.qty) ||
            item.qty < 1 ||
            item.qty > 100
          ) {
            return errorResponse("Article invalide");
          }

          const product = catalog.find(p => p.handle === item.handle);

          if (!product) {
            return errorResponse("Produit introuvable");
          }

          const variants = Array.isArray(product.variants)
            ? product.variants
            : [];

          const variant = variants.length
            ? variants[item.variantIndex]
            : null;

          if (
            (variants.length && !variant) ||
            (!variants.length && item.variantIndex !== -1)
          ) {
            return errorResponse("Taille ou couleur invalide");
          }

          const key = `${item.handle}:${item.variantIndex}`;
          const requested = (requestedQuantities.get(key) || 0) + item.qty;
          requestedQuantities.set(key, requested);

          const stock = Number(
            variant ? variant.qty : product.stock
          );

          if (!Number.isInteger(stock) || requested > stock) {
            return errorResponse(
              `Stock insuffisant pour ${product.title}`
            );
          }

          const price = Number(product.price);

          if (
            !Number.isFinite(price) ||
            price <= 0 ||
            !Number.isSafeInteger(Math.round(price * 100))
          ) {
            return errorResponse("Prix du produit invalide", 500);
          }

          const options = variant
            ? Object.entries(variant)
                .filter(([key]) => key !== "qty")
                .map(([key, value]) => `${key} : ${value}`)
                .join(" / ")
            : "";

          validated.push({
            name: options
              ? `${product.title} — ${options}`
              : product.title,
            amount: Math.round(price * 100),
            quantity: item.qty
          });
        }

        const params = new URLSearchParams();
        params.set("mode", "payment");

        const origin = url.origin;

        params.set(
          "success_url",
          `${origin}/?payment=success&session_id={CHECKOUT_SESSION_ID}`
        );

        params.set(
          "cancel_url",
          `${origin}/?payment=cancel`
        );

        validated.forEach((item, index) => {
          params.set(
            `line_items[${index}][price_data][currency]`,
            "eur"
          );
          params.set(
            `line_items[${index}][price_data][product_data][name]`,
            item.name
          );
          params.set(
            `line_items[${index}][price_data][unit_amount]`,
            String(item.amount)
          );
          params.set(
            `line_items[${index}][quantity]`,
            String(item.quantity)
          );
        });

        const stripeResponse = await fetch(
          "https://api.stripe.com/v1/checkout/sessions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
              "Content-Type": "application/x-www-form-urlencoded"
            },
            body: params.toString()
          }
        );

        const session = await stripeResponse.json();

        if (!stripeResponse.ok || !session.url) {
          console.error(
            "Échec de création de session Stripe",
            stripeResponse.status
          );
          return errorResponse(
            "Impossible de préparer le paiement",
            502
          );
        }

        return Response.json({ url: session.url });
      } catch (error) {
        console.error("Erreur de paiement", error);
        return errorResponse(
          "Une erreur est survenue lors du paiement",
          500
        );
      }
    }

    return errorResponse("Not found", 404);
  }
};
