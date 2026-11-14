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
        const stripeResponse = await fetch(
          "https://api.stripe.com/v1/account",
          {
            headers: {
              Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`
            }
          }
        );

        if (!stripeResponse.ok) {
          return Response.json(
            {
              ok: false,
              stripe: false,
              message: "Stripe a refusé la clé API"
            },
            { status: 500 }
          );
        }

        return Response.json({
          ok: true,
          stripe: true,
          message: "Connexion Stripe OK"
        });
      } catch (error) {
        return Response.json(
          {
            ok: false,
            stripe: false,
            message: "Impossible de contacter Stripe"
          },
          { status: 500 }
        );
      }
    }


if (url.pathname === "/api/create-checkout-session" && request.method === "POST") {
  try {
    const { items } = await request.json();

    if (!Array.isArray(items) || items.length === 0) {
      return Response.json({ error: "Panier vide" }, { status: 400 });
    }

    const products = items.map(item => ({
      price_data: {
        currency: "eur",
        product_data: { name: item.title },
        unit_amount: Math.round(item.price * 100)
      },
      quantity: item.qty
    }));

    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("success_url", new URL("/?payment=success", request.url).href);
    params.set("cancel_url", new URL("/?payment=cancel", request.url).href);

    products.forEach((p, i) => {
      params.set(`line_items[${i}][price_data][currency]`, "eur");
      params.set(`line_items[${i}][price_data][product_data][name]`, p.price_data.product_data.name);
      params.set(`line_items[${i}][price_data][unit_amount]`, String(p.price_data.unit_amount));
      params.set(`line_items[${i}][quantity]`, String(p.quantity));
    });

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params
    });

    const session = await response.json();

    if (!response.ok) {
      throw new Error(session.error?.message || "Erreur Stripe");
    }

    return Response.json({ url: session.url });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

    
    return Response.json(
      { error: "Not found" },
      { status: 404 }
    );
  }
};
