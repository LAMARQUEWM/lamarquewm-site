
const grid = document.getElementById("productGrid");
const drawer = document.getElementById("cartDrawer");
const overlay = document.getElementById("overlay");

const catalog = PRODUCTS;
const findProduct = handle => catalog.find(p => p.handle === handle);
const variantsOf = p => Array.isArray(p.variants) ? p.variants : [];
const variantLabel = v => Object.entries(v)
  .filter(([key]) => key !== "qty")
  .map(([key, value]) => `${key} : ${value}`)
  .join(" / ");

let cart;
try {
  cart = JSON.parse(localStorage.getItem("wm_cart") || "[]");
  if (!Array.isArray(cart)) cart = [];
} catch {
  cart = [];
}

function euro(n) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR"
  }).format(n);
}

function stockOf(p, index) {
  const variants = variantsOf(p);
  if (variants.length) {
    return Number(variants[index]?.qty || 0);
  }
  return Number(p.stock || 0);
}

function selectedVariant(handle) {
  const p = findProduct(handle);
  if (!p) return null;
  if (!variantsOf(p).length) return -1;

  const select = document.querySelector(
    `[data-variant-for="${CSS.escape(handle)}"]`
  );
  return select && select.value !== "" ? Number(select.value) : null;
}

function updateSelection(handle) {
  const p = findProduct(handle);
  const index = selectedVariant(handle);
  const button = [...document.querySelectorAll(".add")]
    .find(b => b.dataset.handle === handle);
  if (!p || !button) return;

  const available = index !== null && stockOf(p, index) > 0;
  button.disabled = !available;
}

function renderProducts() {
  grid.innerHTML = catalog.map(p => {
    const variants = variantsOf(p);
    const totalStock = variants.length
      ? variants.reduce((sum, v) => sum + Number(v.qty || 0), 0)
      : Number(p.stock || 0);

    const selector = variants.length ? `
      <label style="display:block;margin:12px 0">
        Taille / couleur :
        <select data-variant-for="${p.handle}"
          style="display:block;width:100%;padding:12px;margin-top:6px;background:#fff;color:#111">
          <option value="">Choisir une option</option>
          ${variants.map((v, i) => `
            <option value="${i}" ${Number(v.qty) <= 0 ? "disabled" : ""}>
              ${variantLabel(v)} ${Number(v.qty) <= 0 ? "— Épuisé" : ""}
            </option>
          `).join("")}
        </select>
      </label>` : "";

    return `
      <article class="product">
        <div class="product-image">
          <img src="${p.image}" alt="${p.title}" loading="lazy">
        </div>
        <div class="product-info">
          <div class="product-top">
            <h3>${p.title}</h3>
            <span class="price">${euro(p.price)}</span>
          </div>
          <p class="desc">${p.description || "Création originale La Marque WM."}</p>
          <span class="availability ${totalStock <= 0 ? "out" : ""}">
            ${totalStock > 0 ? totalStock + " pièce(s) en stock" : "RUPTURE"}
          </span>
          ${selector}
          <button class="add" data-handle="${p.handle}" disabled>
            AJOUTER AU PANIER
          </button>
        </div>
      </article>`;
  }).join("");

  document.querySelectorAll("[data-variant-for]").forEach(select => {
    select.addEventListener("change", () => {
      updateSelection(select.dataset.variantFor);
    });
  });

  document.querySelectorAll(".add").forEach(button => {
    button.addEventListener("click", () => addToCart(button.dataset.handle));
    updateSelection(button.dataset.handle);
  });
}

function addToCart(handle) {
  const p = findProduct(handle);
  if (!p) return;

  const index = selectedVariant(handle);
  if (index === null) {
    alert("Choisis une taille ou une couleur.");
    return;
  }

  const available = stockOf(p, index);
  const found = cart.find(c =>
    c.handle === handle && c.variantIndex === index
  );

  const currentQty = found ? found.qty : 0;
  if (currentQty >= available) {
    alert("Stock maximum atteint pour cette option.");
    return;
  }

  if (found) {
    found.qty++;
  } else {
    cart.push({ handle, variantIndex: index, qty: 1 });
  }

  save();
  openCart();
}

function removeItem(handle, variantIndex) {
  cart = cart.filter(c =>
    !(c.handle === handle && c.variantIndex === variantIndex)
  );
  save();
}

function save() {
  localStorage.setItem("wm_cart", JSON.stringify(cart));
  renderCart();
}

function renderCart() {
  const items = document.getElementById("cartItems");
  let total = 0;
  let count = 0;

  cart = cart.filter(c => {
    const p = findProduct(c.handle);
    if (!p) return false;

    if (!Number.isInteger(c.variantIndex)) return false;
    if (!Number.isInteger(c.qty) || c.qty <= 0) return false;
    return stockOf(p, c.variantIndex) > 0;
  });

  cart.forEach(c => {
    c.qty = Math.min(c.qty, stockOf(findProduct(c.handle), c.variantIndex));
  });

  items.innerHTML = cart.length ? cart.map((c, i) => {
    const p = findProduct(c.handle);
    const variant = variantsOf(p)[c.variantIndex];
    total += p.price * c.qty;
    count += c.qty;

    return `
      <div class="cart-item">
        <img src="${p.image}" alt="">
        <div>
          <strong>${p.title}</strong>
          ${variant ? `<p>${variantLabel(variant)}</p>` : ""}
          <p>Quantité : ${c.qty}</p>
          <p>${euro(p.price * c.qty)}</p>
        </div>
        <button class="remove" data-remove="${i}">×</button>
      </div>`;
  }).join("") : '<p style="color:#888">Ton panier est vide.</p>';

  document.getElementById("cartTotal").textContent = euro(total);
  document.getElementById("cartCount").textContent = count;

  items.querySelectorAll("[data-remove]").forEach(button => {
    button.addEventListener("click", () => {
      const c = cart[Number(button.dataset.remove)];
      if (c) removeItem(c.handle, c.variantIndex);
    });
  });

  localStorage.setItem("wm_cart", JSON.stringify(cart));
}

function openCart() {
  drawer.classList.add("open");
  overlay.classList.add("show");
  drawer.setAttribute("aria-hidden", "false");
}

function closeCart() {
  drawer.classList.remove("open");
  overlay.classList.remove("show");
  drawer.setAttribute("aria-hidden", "true");
}

document.getElementById("cartButton").addEventListener("click", openCart);
document.getElementById("closeCart").addEventListener("click", closeCart);
overlay.addEventListener("click", closeCart);

async function checkout() {
  if (!cart.length) {
    alert("Ton panier est vide.");
    return;
  }

  const button = document.getElementById("checkoutButton");
  button.disabled = true;

  try {
    const response = await fetch("/api/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: cart })
    });

    const data = await response.json();

    if (!response.ok || !data.url) {
      throw new Error(data.error || "Erreur de paiement");
    }

    window.location.href = data.url;
  } catch (error) {
    alert("Impossible de lancer le paiement : " + error.message);
    button.disabled = false;
  }
}

document.getElementById("checkoutButton")
  .addEventListener("click", checkout);

renderProducts();
renderCart();
