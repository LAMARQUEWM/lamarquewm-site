
const grid=document.getElementById('productGrid');
const drawer=document.getElementById('cartDrawer');
const overlay=document.getElementById('overlay');
let cart=JSON.parse(localStorage.getItem('wm_cart')||'[]');

function euro(n){return new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(n)}
function renderProducts(){
  grid.innerHTML=PRODUCTS.map(p=>`
    <article class="product">
      <div class="product-image"><img src="${p.image}" alt="${p.title}" loading="lazy"></div>
      <div class="product-info">
        <div class="product-top"><h3>${p.title}</h3><span class="price">${euro(p.price)}</span></div>
        <p class="desc">${p.description||'Création originale La Marque WM.'}</p>
        <span class="availability ${p.stock<=0?'out':''}">${p.stock>0?p.stock+' pièce'+(p.stock>1?'s':'')+' en stock':'RUPTURE'}</span>
        <button class="add" ${p.stock<=0?'disabled':''} onclick="addToCart('${p.handle}')">AJOUTER AU PANIER</button>
      </div>
    </article>`).join('');
}
function addToCart(handle){
  const p=PRODUCTS.find(x=>x.handle===handle); if(!p)return;
  const found=cart.find(x=>x.handle===handle);
  if(found) found.qty++; else cart.push({handle,qty:1});
  save(); openCart();
}
function removeItem(handle){cart=cart.filter(x=>x.handle!==handle);save()}
function save(){localStorage.setItem('wm_cart',JSON.stringify(cart));renderCart()}
function renderCart(){
  const items=document.getElementById('cartItems'); let total=0; let count=0;
  items.innerHTML=cart.length?cart.map(c=>{
    const p=PRODUCTS.find(x=>x.handle===c.handle); if(!p)return '';
    total+=p.price*c.qty; count+=c.qty;
    return `<div class="cart-item">
      <img src="${p.image}" alt="">
      <div><strong>${p.title}</strong><p>Quantité : ${c.qty}</p><p>${euro(p.price*c.qty)}</p></div>
      <button class="remove" onclick="removeItem('${p.handle}')">×</button>
    </div>`;
  }).join(''):'<p style="color:#888">Ton panier est vide.</p>';
  document.getElementById('cartTotal').textContent=euro(total);
  document.getElementById('cartCount').textContent=count;
}
function openCart(){drawer.classList.add('open');overlay.classList.add('show');drawer.setAttribute('aria-hidden','false')}
function closeCart(){drawer.classList.remove('open');overlay.classList.remove('show');drawer.setAttribute('aria-hidden','true')}
document.getElementById('cartButton').addEventListener('click',openCart);
document.getElementById('closeCart').addEventListener('click',closeCart);
overlay.addEventListener('click',closeCart);
renderProducts(); renderCart();

async function checkout() {
  if (cart.length === 0) {
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
