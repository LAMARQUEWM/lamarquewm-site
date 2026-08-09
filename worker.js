export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        message: "La Marque WM API fonctionne"
      });
    }

    return Response.json(
      { error: "Not found" },
      { status: 404 }
    );
  }
};
