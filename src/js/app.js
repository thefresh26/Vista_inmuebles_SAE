/* ── SUPABASE ── */
/* Mismo proyecto Supabase que VISTA; se agregaron 2 columnas nuevas a
   inventario_SAE: expresion_interes (boolean) y codigo_subasta (text).
   NOTA: la cantidad de expresiones de interés por folio (no solo Sí/No)
   está pendiente de un archivo fuente con el detalle por interesado;
   mientras tanto se muestra Sí/No según la columna booleana actual. */
const SUPABASE_URL='https://niemyawlnebylpidfefh.supabase.co';
const SUPABASE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pZW15YXdsbmVieWxwaWRmZWZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1OTAxNzUsImV4cCI6MjA5NDE2NjE3NX0.sUV59NOKURYE6kPDETaM_rddX_cDRltlu7xblC-OJF4';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ── AUTH ── */
/* Las contraseñas ya NO viven en este archivo. El login se valida contra
   Supabase Auth (auth.signInWithPassword), que guarda las contraseñas
   hasheadas del lado del servidor. Los usuarios se crean una sola vez
   desde el panel de Supabase (Authentication > Users), asignándoles un
   "role" en user_metadata ('broker' o 'comercial'). Como Supabase Auth
   identifica usuarios por email, se mantiene un mapeo usuario -> email
   para que el login siga sintiéndose igual que antes (usuario corto en
   vez de un correo completo). */
let currentRole = null;
let currentUser = null;

const USER_EMAILS = {
  'broker2026':    'broker2026@sae-inmuebles.app',
  'comercial2026': 'comercial2026@sae-inmuebles.app',
  'SAE':           'sae@sae-inmuebles.app'
};

document.addEventListener('DOMContentLoaded',async function(){
  document.getElementById('l-user').focus();
  ['l-user','l-pass'].forEach(id=>{
    document.getElementById(id).addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
  });

  /* Si ya hay una sesión válida (ej. el usuario recargó la página), se
     entra directo sin pedir credenciales de nuevo. */
  const { data:{ session } } = await supabaseClient.auth.getSession();
  if(session){
    currentUser = session.user;
    currentRole = session.user.user_metadata?.role || 'comercial';
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('hero-eyebrow').textContent = 'CONSULTA DE EXPRESIONES DE INTERÉS · SAE · 2026';
  }
});

async function doLogin(){
  const userInput = document.getElementById('l-user').value.trim();
  const pass = document.getElementById('l-pass').value;
  const err  = document.getElementById('l-err');
  const btn  = document.getElementById('l-btn');
  if(!userInput || !pass) return;

  /* Permite loguearse con el usuario corto de siempre o con un email
     directo, por si en el futuro se agregan más cuentas desde Supabase
     sin tener que tocar este archivo. */
  const email = USER_EMAILS[userInput] || userInput;

  btn.disabled = true;
  const btnTextoOriginal = btn.textContent;
  btn.textContent = 'Ingresando...';

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: pass });

  btn.disabled = false;
  btn.textContent = btnTextoOriginal;

  if(error || !data.session){
    err.style.display = 'block';
    document.getElementById('l-pass').value = '';
    document.getElementById('l-pass').focus();
    return;
  }

  currentUser = data.user;
  currentRole = data.user.user_metadata?.role || 'comercial';
  document.getElementById('login-overlay').style.display = 'none';
  document.getElementById('hero-eyebrow').textContent = 'CONSULTA DE EXPRESIONES DE INTERÉS · SAE · 2026';
}

document.getElementById('qi').addEventListener('keydown',e=>{if(e.key==='Enter' && !e.shiftKey){e.preventDefault();buscar();}});

function nul(v){return v===null||v===undefined||v==='';}
function fmt(v){if(nul(v))return '<span class="null">—</span>';return String(v);}
function esc(v){return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

function icon(path){return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">${path}</svg>`;}

/* Expresión de interés: en vez de solo mostrar la cantidad, se arma un
   desplegable con los nombres de los interesados en ese folio (columna
   "analista" de expresiones_interes, una fila por interesado). Ese texto
   es libre y a veces mezcla el nombre del comercial que gestionó la
   solicitud junto con el del cliente, separados por "/" o por un guion.
   Por pedido explícito se filtran los nombres de comerciales conocidos
   (Alexandra Balza, Jeffrey/Jeff Guerrero, Steven Valencia, David
   Buitrago, Yicela Caro) para que no aparezcan en la lista de
   interesados. El resto de nombres que aparecen (brokers/oferentes
   externos, ej. Nova, Fabián Galvis, Ernesto Arteaga, Edwin Jiménez,
   etc.) sí son personas reales de interés y se muestran normalmente.
   Sin interesados -> chip "Ninguna". */
const NOMBRES_COMERCIALES = [
  /alexandra/i,
  /jeffrey/i,
  /\bjeff\b/i,
  /steven\s*valencia/i,
  /david\s*buitrago/i,
  /yicela\s*caro/i
];

/* El texto libre de "analista" también mezcla notas internas del equipo
   comercial junto con el nombre del cliente (ej: "... / PROXIMO VENTA",
   "... / PRIORIZAR", "... / REVISAR CUAL VAN A COMPRAR", "... / VENTA",
   "... / SIN DEUDA", "... / LO TIENE LA ANT"). Se filtran esos
   fragmentos para que solo queden nombres. Como es texto libre y en
   constante crecimiento, esta lista cubre los patrones vistos hasta
   ahora; si aparecen notas nuevas que se cuelen, hay que agregarlas
   aquí. */
const NOTAS_INTERNAS = [
  /pr[i]?or[i]?zar/i, /* cubre "priorizar" y errores de tipeo como "prorizar" */
  /^broker$/i, /* "BROKER" suelto, sin nombre pegado (queda huérfano al separar) */
  /revisar/i,
  /pr[oó]xim[oa]\s*(en\s*)?venta/i,
  /\bventa\b/i,
  /viabilidad/i,
  /utilizar/i,
  /dinero de subasta/i,
  /perdio/i,
  /interes en compra/i,
  /ya tiene/i,
  /otras expresiones/i,
  /solo falta/i,
  /llamar/i,
  /urgente/i,
  /publicad[oa]/i,
  /sin deuda/i,
  /lo tiene la ant/i,
  /debe elegir/i,
  /entra al mail/i,
  /^cliente de privado$/i,
  /^cliente$/i,
  /representa/i,
  /presenta/i,
  /solicita/i,
  /arrendatario/i,
  /remitid[oa]/i,
  /\bremite\b/i,
  /\bmanda\b/i,
  /referid[oa]/i,
  /parece/i,
  /decide/i,
  /\belige\b/i,
  /quiere/i,
  /compr[ao]r?\b/i,
  /\bmail\b/i,
  /ocupantes/i,
  /\bfolios\b/i
];

/* Además de las notas conocidas de arriba, cualquier fragmento con más
   de 5 palabras se trata como comentario/oración (no como nombre) y se
   descarta directamente, aunque a veces traiga un nombre real mezclado
   (ej: "Gustavo Hernandez lo representa Grupo Brand"). Es una decisión
   explícita: se prefiere perder algún nombre suelto en un caso raro
   antes que mostrar texto de comentario en la lista de interesados. */
const MAX_PALABRAS_NOMBRE = 5;

function limpiarNombreInteresado(texto){
  return String(texto)
    /* separa por "/" y también por guiones rodeados de espacios (" - " o
       " -- "), que es como suelen separar nombre y nota cuando no hay
       diagonal (ej: "STEVEN VALENCIA HERRERA -priorizar"). */
    .split(/\/|\s-{1,2}\s?|\s?-{1,2}\s/)
    .map(s=>s.trim())
    .filter(s=>s.length>0)
    .filter(s=>s.split(/\s+/).length<=MAX_PALABRAS_NOMBRE)
    .filter(s=>!NOMBRES_COMERCIALES.some(rx=>rx.test(s)))
    .filter(s=>!NOTAS_INTERNAS.some(rx=>rx.test(s)))
    .map(s=>s.replace(/^(IC|CLIENTE|BROKER)\s+/i,'').trim())
    .map(s=>s.replace(/\s+(BROKER|CLIENTE)$/i,'').trim())
    .filter(s=>s.length>0);
}

let dropdownSeq = 0;
function dropdownInteres(registros){
  const total = (registros||[]).length;
  if(total<=0) return '<span class="chip ei-no">✕ Ninguna</span>';

  /* Un mismo cliente puede quedar repetido si expresó interés más de una
     vez (varias filas en la base) o si su nombre salió más de una vez al
     separar el texto libre. Se deduplica sin distinguir mayúsculas para
     no mostrar el mismo nombre dos veces en la lista. */
  const vistos = new Set();
  const nombres = (registros||[])
    .flatMap(limpiarNombreInteresado)
    .filter(n=>{
      const k = n.toUpperCase();
      if(vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
  const lista = nombres.length ? nombres : ['(sin nombre registrado)'];

  const id = `ei-dd-${dropdownSeq++}`;
  const items = lista.map(c=>`<li>${esc(c)}</li>`).join('');
  return `
    <div class="ei-dropdown">
      <button type="button" class="chip ei-yes ei-toggle" onclick="toggleInteres('${id}')">
        ✓ ${total} interesado${total>1?'s':''} <span class="ei-caret">▾</span>
      </button>
      <ul id="${id}" class="ei-list" hidden>${items}</ul>
    </div>`;
}

function cerrarTodosLosDropdowns(exceptoId){
  document.querySelectorAll('.ei-list').forEach(el=>{
    if(el.id !== exceptoId) el.hidden = true;
  });
}

function toggleInteres(id){
  const el = document.getElementById(id);
  if(!el) return;
  const estabaOculto = el.hidden;
  cerrarTodosLosDropdowns(id);
  el.hidden = !estabaOculto;
}

/* Cierra cualquier desplegable abierto si el clic ocurre fuera de un
   ".ei-dropdown" (el botón + su lista). Sin esto, los desplegables se
   quedaban abiertos y se apilaban unos sobre otros. */
document.addEventListener('click',function(e){
  if(!e.target.closest('.ei-dropdown')){
    cerrarTodosLosDropdowns(null);
  }
});

/* Separa la entrada de folios por coma "," o diagonal "/", limpia espacios
   y elimina duplicados/valores vacíos. */
function parseFolios(q){
  return [...new Set(
    q.split(/[,/]+/).map(s=>s.trim()).filter(s=>s.length>0)
  )];
}

async function buscar(){
  const raw=document.getElementById('qi').value.trim();
  const sb=document.getElementById('sb');
  const res=document.getElementById('result');
  if(!raw)return;

  const folios=parseFolios(raw);
  if(folios.length===0)return;

  sb.style.display='block';sb.className='loading';
  sb.textContent=`⏳ Consultando ${folios.length} folio${folios.length>1?'s':''}...`;
  res.style.display='none';

  try{
    /* Se usa "or=(fmi.ilike.X,fmi.ilike.Y,...)" en vez de "fmi=in.(...)" para
       que la comparación con Supabase ignore mayúsculas/minúsculas (ilike es
       case-insensitive). Con "in." la comparación es exacta y un folio como
       "50c-786813" no encontraba su fila real "50C-786813". */
    const orFilter=folios
      .map(f=>`fmi.ilike.${encodeURIComponent(f.replace(/[,()]/g,''))}`)
      .join(',');

    const [propResp,interesResp]=await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/inventario_SAE?or=(${orFilter})&select=fmi,codigo_subasta,enlace_inmueble`,{
        headers:{'apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`}
      }),
      fetch(`${SUPABASE_URL}/rest/v1/expresiones_interes?or=(${orFilter})&select=fmi,analista`,{
        headers:{'apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`}
      })
    ]);
    if(!propResp.ok)throw new Error('HTTP '+propResp.status);
    if(!interesResp.ok)throw new Error('HTTP '+interesResp.status);
    const data=await propResp.json();
    const interesData=await interesResp.json();

    /* Agrupa los clientes interesados por FMI (una fila = un cliente).
       Se normaliza a mayúsculas para que no se pierdan coincidencias por
       diferencias de mayúsculas/minúsculas entre esta tabla e
       inventario_SAE (ej. "50c-..." vs "50C-..."). */
    const clientesPorFolio={};
    interesData.forEach(r=>{
      const k=String(r.fmi).toUpperCase();
      if(!clientesPorFolio[k]) clientesPorFolio[k]=[];
      if(!nul(r.analista)) clientesPorFolio[k].push(r.analista);
    });

    const found=new Map(data.map(r=>[String(r.fmi).toUpperCase(),r]));
    const noEncontrados=folios.filter(f=>!found.has(f.toUpperCase()));

    sb.style.display='none';
    res.style.display='block';

    const rows=folios.map(f=>{
      const r=found.get(f.toUpperCase());
      if(!r){
        return `<tr class="row-empty">
          <td class="vm">${esc(f)}</td>
          <td colspan="3"><span class="null">⚠ No se encontró este folio en la base de datos</span></td>
        </tr>`;
      }
      const esUnidad=!nul(r.codigo_subasta);
      const unidadHtml=esUnidad
        ?`<span class="chip cb">${esc(r.codigo_subasta)}</span>`
        :'<span class="null">No aplica</span>';
      const enlaceHtml=nul(r.enlace_inmueble)
        ?'<span class="null">No publicado</span>'
        :`<a class="map-link" href="${esc(r.enlace_inmueble)}" target="_blank">${icon('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>')} Ver inmueble</a>`;
      return `<tr>
        <td class="vm">${esc(r.fmi)}</td>
        <td>${unidadHtml}</td>
        <td>${enlaceHtml}</td>
        <td>${dropdownInteres(clientesPorFolio[String(r.fmi).toUpperCase()]||[])}</td>
      </tr>`;
    }).join('');

    res.innerHTML=`
    <div class="top-card">
      <div class="tc-left">
        <div class="tc-label">Resultado de la consulta</div>
        <div class="fmi-num" style="font-size:16px">${folios.length} folio${folios.length>1?'s':''} consultado${folios.length>1?'s':''}</div>
        <div class="tc-sub">${found.size} encontrado${found.size!==1?'s':''}${noEncontrados.length?` &nbsp;·&nbsp; ${noEncontrados.length} sin resultado`:''}</div>
      </div>
    </div>
    <div class="sec">
      <table class="res-table">
        <thead>
          <tr>
            <th>Folio</th>
            <th>Unidad</th>
            <th>Enlace</th>
            <th>Expresión de Interés</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
    `;
  }catch(e){
    sb.style.display='block';sb.className='error';
    sb.textContent='⚠ Error al consultar la base de datos. Verifica tu conexión e intenta de nuevo.';
  }
}
