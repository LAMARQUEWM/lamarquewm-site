
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
    return `
      <article class="product">
        <button type="button" class="product-open"
          data-handle="${p.handle}"
          style="display:block;width:100%;padding:0;border:0;background:none;color:inherit;text-align:left;cursor:pointer">
          <div class="product-image">
            <img src="${p.image}" alt="${p.title}" loading="lazy">
          </div>
          <div class="product-info">
            <h3>${p.title}</h3>
            <span class="price">${euro(p.price)}</span>
          </div>
        </button>
      </article>`;
  }).join("");

  grid.querySelectorAll(".product-open").forEach(button => {
    button.addEventListener("click", () => {
      openProduct(button.dataset.handle);
    });
  });
}
function openProduct(handle) {
  const p = findProduct(handle);
  if (!p) return;

  const variants = variantsOf(p);
  const totalStock = variants.length
    ? variants.reduce((sum, v) => sum + Number(v.qty || 0), 0)
    : Number(p.stock || 0);

  const images = [...new Set([
    p.image,
    ...(Array.isArray(p.gallery) ? p.gallery : [])
  ].filter(Boolean))];

  const modal = document.createElement("dialog");

  modal.style.cssText = `
    width: min(1000px, 94vw);
    max-height: 90vh;
    padding: 24px;
    background: #111;
    color: #fff;
    border: 1px solid #333;
    overflow: auto;
  `;

  modal.innerHTML = `
    <button type="button" class="close-product"
      style="display:block;margin:0 0 18px auto;background:none;color:white;border:0;font-size:28px;cursor:pointer">
      ×
    </button>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:30px">

      <div>
        <img class="main-product-photo"
          src="${images[0]}"
          alt="${p.title}"
          style="width:100%;max-height:550px;object-fit:contain">

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          ${images.map((src, i) => `
            <button type="button" class="gallery-thumb"
              data-index="${i}"
              style="padding:0;border:1px solid #555;background:none;cursor:pointer">
              <img src="${src}" alt="Photo ${i + 1}"
                style="width:65px;height:80px;object-fit:cover">
            </button>
          `).join("")}
        </div>
      </div>

      <div>
        <h2 style="font-size:30px;margin:0 0 15px">
          ${p.title}
        </h2>

        <p style="font-size:24px;font-weight:bold">
          ${euro(p.price)}
        </p>

        

        <p>
          ${totalStock > 0
            ? totalStock + " pièce(s) en stock"
            : "RUPTURE DE STOCK"}
        </p>

       ${variants.length ? `
  <div class="variant-picker" style="margin:20px 0">

    <div class="color-picker"></div>

    <div class="size-picker"></div>

    <select data-variant-for="${p.handle}"
      style="display:none">
      <option value="">Choisir une option</option>
      ${variants.map((v, i) => `
        <option value="${i}"
          ${Number(v.qty) <= 0 ? "disabled" : ""}>
          ${variantLabel(v)}
        </option>
      `).join("")}
    </select>

  </div>
` : ""}

        <button type="button" class="add"
          data-handle="${p.handle}" disabled>
          AJOUTER AU PANIER
        </button>
                  <div class="wm-product-description">
            ${(() => {
              const sections = {
                "Description du produit": "",
                "Taille et coupe": "",
                "Composition et caractéristiques": "",
                "Instructions d’entretien": "",
                "Expédition et livraison": ""
              };

              let current = "Description du produit";

              (p.description || "Création originale La Marque WM.")
                .split(/\r?\n/)
                .forEach(line => {
                  const text = line.trim();

                  if (/^Taille et coupe\s*:/i.test(text)) {
                    current = "Taille et coupe";
                  } else if (/^Entretien\s*:/i.test(text)) {
                    current = "Instructions d’entretien";
                  } else if (/^À propos\s*:/i.test(text)) {
                    current = "Composition et caractéristiques";
                  } else if (/^\*?\s*Expédition/i.test(text)) {
                    current = "Expédition et livraison";
                    sections[current] += line + "\n";
                    return;
                  } else {
                    sections[current] += line + "\n";
                    return;
                  }

                  sections[current] += text.replace(/^[^:]*:\s*/, "") + "\n";
                });

              return Object.entries(sections)
                .filter(([title, content]) => content.trim())
                .map(([title, content]) => `
                  <details class="wm-description-section">
                    <summary>${title}</summary>
                    <div class="wm-description-content" style="white-space:pre-line">
                      ${content.trim().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}
                    </div>
                  </details>
                `).join("");
            })()}
          </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.addEventListener("close", () => modal.remove());

  modal.querySelector(".close-product")
    .addEventListener("click", () => modal.close());

  modal.querySelectorAll(".gallery-thumb").forEach(button => {
    button.addEventListener("click", () => {
      modal.querySelector(".main-product-photo").src =
        images[Number(button.dataset.index)];
    });
  });

 const select = modal.querySelector("select");

const colorPhotos = {
  "sweat-a-capuche-big-wm": {
    "Blanc": "/IMG-0086.webp",
    "Rouge": "/IMG-0088.webp",
    "Noir": "/IMG-0091.webp"
  },
  "bonnet-a-pompon": {
    "Gris": "/IMG-0169.webp"
  }
};
if (select) {
  const colorPicker = modal.querySelector(".color-picker");
  const sizePicker = modal.querySelector(".size-picker");

  const colors = [...new Set(variants.map(v => v.Couleur).filter(Boolean))];
  const sizes = [...new Set(variants.map(v => v.Taille).filter(Boolean))];

  let selectedColor = "";
  let selectedSize = "";

  const colorCodes = {
    "Blanc": "#ffffff",
    "Noir": "#000000",
    "Rouge": "#c8102e",
    "Gris": "#808080",
    "Bleu": "#2457a7"
  };

  function refreshPickers() {
    colorPicker.innerHTML = colors.length ? `
      <p style="margin-bottom:10px">Couleur : ${selectedColor}</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${colors.map(color => `
          <button type="button" data-color="${color}"
            title="${color}" aria-label="${color}"
            style="width:36px;height:36px;border-radius:50%;
            background:${colorCodes[color] || "#999"};
            border:2px solid #777;
            outline:${selectedColor === color ? "2px solid white" : "none"};
            outline-offset:3px;cursor:pointer">
          </button>
        `).join("")}
      </div>
    ` : "";

    sizePicker.innerHTML = sizes.length ? `
      <p style="margin:20px 0 10px">Taille :</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${sizes.map(size => {
          const available = variants.some(v =>
            v.Taille === size &&
            (!selectedColor || v.Couleur === selectedColor) &&
            Number(v.qty) > 0
          );

          return `
            <button type="button" data-size="${size}"
              ${available ? "" : "disabled"}
              style="min-width:45px;padding:12px;
              border:1px solid #777;
              background:${selectedSize === size ? "white" : "#171717"};
              color:${selectedSize === size ? "black" : "white"};
              opacity:${available ? "1" : "0.3"};
              cursor:${available ? "pointer" : "not-allowed"}">
              ${size}
            </button>
          `;
        }).join("")}
      </div>
    ` : "";

    const index = variants.findIndex(v =>
      (!colors.length || v.Couleur === selectedColor) &&
      (!sizes.length || v.Taille === selectedSize) &&
      Number(v.qty) > 0
    );

    select.value = index >= 0 ? String(index) : "";
    updateSelection(handle);

    colorPicker.querySelectorAll("[data-color]").forEach(button => {
      button.addEventListener("click", () => {
        selectedColor = button.dataset.color;
        selectedSize = "";

        const photo = colorPhotos[handle]?.[selectedColor];

        if (photo) {
          modal.querySelector(".main-product-photo").src = photo;
        }

        refreshPickers();
      });
    });

    sizePicker.querySelectorAll("[data-size]").forEach(button => {
      button.addEventListener("click", () => {
        selectedSize = button.dataset.size;
        refreshPickers();
      });
    });
  }

  refreshPickers();
}

  modal.querySelector(".add").addEventListener("click", () => {
    addToCart(handle);
    modal.close();
  });

  modal.showModal();
  updateSelection(handle);
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

const paymentParams = new URLSearchParams(window.location.search);

if (
  paymentParams.get("payment") === "success" &&
  paymentParams.get("session_id")
) {
  cart = [];
  save();
  closeCart();

  alert("Merci pour ta commande ! Ton paiement est en cours de confirmation.");

  window.history.replaceState(
    {},
    "",
    window.location.pathname + window.location.hash
  );
}
