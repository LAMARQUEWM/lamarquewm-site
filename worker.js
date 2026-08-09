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

    return Response.json(
      { error: "Not found" },
      { status: 404 }
    );
  }
};
