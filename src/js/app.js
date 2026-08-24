/* ── SUPABASE ── */
/* Mismo proyecto Supabase que VISTA; se agregaron 2 columnas nuevas a
   inventario_SAE: expresion_interes (boolean) y codigo_subasta (text).
   La cantidad de interesados por folio se obtiene ya resuelta desde la
   función RPC buscar_folios (columna `interesados`) y se muestra
   directamente (ver dropdownInteres más abajo). */
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
    document.getElementById('logout-btn').style.display = 'inline-block';
    iniciarControlInactividad();
  }
});

/* ── CIERRE DE SESIÓN AUTOMÁTICO POR INACTIVIDAD ──
   Si el usuario no interactúa con la página durante MINUTOS_INACTIVIDAD,
   se cierra la sesión automáticamente y se recarga la página. Cualquier
   click, tecla, movimiento de mouse o scroll reinicia el contador. */
const MINUTOS_INACTIVIDAD = 10;
let temporizadorInactividad = null;

function iniciarControlInactividad(){
  ['click','keydown','mousemove','scroll','touchstart'].forEach(ev=>{
    document.addEventListener(ev, reiniciarTemporizadorInactividad, {passive:true});
  });
  reiniciarTemporizadorInactividad();
}

function reiniciarTemporizadorInactividad(){
  if(temporizadorInactividad) clearTimeout(temporizadorInactividad);
  temporizadorInactividad = setTimeout(cerrarSesionPorInactividad, MINUTOS_INACTIVIDAD * 60 * 1000);
}

async function cerrarSesionPorInactividad(){
  await registrarLog('logout_inactividad', `Sesión cerrada tras ${MINUTOS_INACTIVIDAD} min de inactividad`);
  await supabaseClient.auth.signOut();
  location.reload();
}

/* ── CIERRE DE SESIÓN MANUAL ──
   Disparado por el botón "Cerrar sesión" del encabezado. */
async function cerrarSesionManual(){
  await registrarLog('logout', null);
  await supabaseClient.auth.signOut();
  location.reload();
}

/* ── TRAZABILIDAD ──
   Registra eventos clave (login, búsquedas, logout) en la tabla
   logs_acceso. Si falla (ej. sin conexión), no interrumpe el uso normal
   de la app: la trazabilidad es un "mejor esfuerzo", no un bloqueo. */
async function registrarLog(accion, detalle){
  try{
    await supabaseClient.from('logs_acceso').insert({
      usuario_email: currentUser?.email || null,
      accion,
      detalle: detalle || null
    });
  }catch(e){ /* no bloquea la UI si falla el log */ }
}

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
  document.getElementById('logout-btn').style.display = 'inline-block';
  registrarLog('login', null);
  iniciarControlInactividad();
}

document.getElementById('qi').addEventListener('keydown',e=>{if(e.key==='Enter' && !e.shiftKey){e.preventDefault();buscar();}});

function nul(v){return v===null||v===undefined||v==='';}
function esc(v){return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

function icon(path){return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">${path}</svg>`;}

/* Expresión de interés: se muestra solo la cantidad de interesados (dato
   exacto tomado de la base de datos), sin desplegable de nombres. El
   texto libre de origen (columna "analista" de expresiones_interes)
   mezcla nombres de clientes, nombres de comerciales/brokers, notas
   internas y errores de tipeo de forma muy inconsistente; mostrarlo
   generaba confusión en vez de ayudar, así que se decidió dejar solo el
   número. Sin interesados -> chip "Ninguna". */
function dropdownInteres(total){
  total = total||0;
  if(total<=0) return '<span class="chip ei-no">✕ Ninguna</span>';
  return `<span class="chip ei-yes">✓ ${total} interesado${total>1?'s':''}</span>`;
}

/* Uniformidad de datos: el FMI siempre se muestra en mayúsculas y sin
   espacios extra, sin importar cómo esté cargado en la base. */
function fmtFmi(v){ return nul(v) ? '—' : String(v).trim().toUpperCase(); }

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
  const btn=document.querySelector('.sbtn');
  if(!raw)return;

  /* Evita disparar varias búsquedas a la vez si el usuario hace clic o
     presiona Enter repetidamente mientras la consulta anterior sigue en
     curso (el botón se deshabilita hasta que termine, igual que en el
     login). */
  if(btn && btn.disabled) return;

  const folios=parseFolios(raw);
  if(folios.length===0)return;

  if(btn) btn.disabled = true;
  sb.style.display='block';sb.className='loading';
  sb.textContent=`⏳ Consultando ${folios.length} folio${folios.length>1?'s':''}...`;
  res.style.display='none';

  try{
    /* La consulta real (join entre inventario_SAE y expresiones_interes,
       nombres de columnas, filtros ilike, etc.) ya NO vive en este archivo:
       se movió a la función buscar_folios(text[]) del lado de Supabase
       (ver endurecer_sae.sql). El navegador solo envía la lista de folios
       y recibe de vuelta exactamente los campos necesarios para mostrar —
       nada de estructura interna de la base de datos queda visible en el
       Network tab del navegador. */
    const { data, error } = await supabaseClient.rpc('buscar_folios', { p_folios: folios });
    if(error) throw error;

    const found=new Map((data||[]).map(r=>[String(r.fmi).toUpperCase(),r]));
    const noEncontrados=folios.filter(f=>!found.has(f.toUpperCase()));

    registrarLog('busqueda', folios.join(', '));

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
        ?`<span class="chip cb">${esc(String(r.codigo_subasta).trim().toUpperCase())}</span>`
        :'<span class="null">No aplica</span>';
      const enlaceHtml=nul(r.enlace_inmueble)
        ?'<span class="null">No publicado</span>'
        :`<a class="map-link" href="${esc(r.enlace_inmueble)}" target="_blank">${icon('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>')} Ver inmueble</a>`;
      return `<tr>
        <td class="vm">${esc(fmtFmi(r.fmi))}</td>
        <td>${unidadHtml}</td>
        <td>${enlaceHtml}</td>
        <td>${dropdownInteres(r.interesados)}</td>
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
  }finally{
    if(btn) btn.disabled = false;
  }
}
