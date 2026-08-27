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
   "role" en user_metadata ('admin', 'comercial', 'comunicaciones', 'juridico'
   o 'sin_acceso'). Como Supabase Auth
   identifica usuarios por email, se mantiene un mapeo usuario -> email
   para que el login siga sintiéndose igual que antes (usuario corto en
   vez de un correo completo) para las cuentas históricas de este visor.
   El resto del personal (todo Activos por Colombia, ya que este mismo
   Supabase Auth se comparte entre varios sistemas) inicia sesión con su
   correo real. Roles vigentes: 'admin', 'comercial', 'comunicaciones',
   'juridico', 'sin_acceso'. */
let currentRole = null;
let currentUser = null;

const USER_EMAILS = {
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
    ocultarLoginOverlay();
    document.getElementById('hero-eyebrow').textContent = 'CONSULTA DE EXPRESIONES DE INTERÉS · SAE · 2026';
    mostrarBarraSesion();
    iniciarControlInactividad();
  }
});

/* Muestra la barra superior de pestañas (Consultar / Administración) y el
   botón de cerrar sesión una vez el usuario está logueado. La pestaña
   "Administración" solo se muestra si el rol es 'admin' — el chequeo real
   de seguridad vive del lado del servidor (ver Edge Function admin-users). */
/* Oculta el overlay de login con una transición suave (fade + leve
   desplazamiento) en vez de un display:none instantáneo. Se deja el
   elemento en el DOM (opacity 0 + pointer-events:none) para no depender
   de temporizadores en JS que deban coincidir con la duración del CSS. */
function ocultarLoginOverlay(){
  document.getElementById('login-overlay').classList.add('lo-hide');
}

function mostrarBarraSesion(){
  document.getElementById('topbar').style.display = 'flex';
  if(currentRole==='admin') document.getElementById('tab-btn-admin').style.display = 'inline-block';
}

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
   de la app: la trazabilidad es un "mejor esfuerzo", no un bloqueo.
   IMPORTANTE: la política de seguridad (RLS) de esta tabla exige que
   usuario_id coincida con auth.uid() de quien inserta — sin este campo
   Supabase rechaza el insert con 403, sin importar el rol. */
async function registrarLog(accion, detalle){
  try{
    await supabaseClient.from('logs_acceso').insert({
      usuario_id: currentUser?.id || null,
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

  /* Permite loguearse con el usuario corto de siempre, con un email
     directo, o con cualquier usuario corto nuevo creado desde el panel
     de administración (se le agrega automáticamente el dominio interno,
     sin tener que tocar este archivo cada vez que se crea alguien). */
  const email = userInput.includes('@')
    ? userInput
    : (USER_EMAILS[userInput] || `${userInput}@sae-inmuebles.app`);

  btn.disabled = true;
  const btnTextoOriginal = btn.textContent;
  btn.textContent = 'Ingresando...';

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: pass });

  btn.disabled = false;
  btn.textContent = btnTextoOriginal;

  if(error || !data.session){
    err.classList.add('show');
    document.getElementById('l-pass').value = '';
    document.getElementById('l-pass').focus();
    return;
  }

  currentUser = data.user;
  currentRole = data.user.user_metadata?.role || 'comercial';
  ocultarLoginOverlay();
  document.getElementById('hero-eyebrow').textContent = 'CONSULTA DE EXPRESIONES DE INTERÉS · SAE · 2026';
  mostrarBarraSesion();
  registrarLog('login', null);
  iniciarControlInactividad();
}

/* ── PANEL DE ADMINISTRACIÓN DE USUARIOS ──
   Solo visible/funcional para currentRole === 'admin'. Administra TODOS
   los usuarios del proyecto Supabase (compartido con otros sistemas de
   Activos por Colombia). Toda la lógica sensible (crear, cambiar rol,
   habilitar/deshabilitar, eliminar) vive en la Edge Function
   'admin-users', que usa la service_role key del lado del servidor y
   vuelve a verificar ahí que quien llama sea admin — el chequeo de rol
   en el navegador es solo para mostrar/ocultar el botón, no es la
   verdadera barrera de seguridad. */

const ROLES_LABEL = {
  admin: 'Admin',
  comercial: 'Comercial',
  comunicaciones: 'Comunicaciones',
  juridico: 'Jurídico',
  sin_acceso: 'Sin acceso'
};
function adminMsg(texto, tipo){
  const el = document.getElementById('admin-msg');
  el.className = tipo;
  el.textContent = texto;
}

/* Cambia entre las pestañas "Consultar" y "Administración". La pestaña de
   administración solo es alcanzable si el botón está visible (currentRole
   === 'admin'); aun así, se vuelve a validar en el servidor con cada
   acción, así que no pasa nada si alguien fuerza esta función a mano. */
function mostrarTab(nombre){
  ['consultar','administracion'].forEach(t=>{
    document.getElementById('tab-'+t).classList.toggle('active', t===nombre);
    document.getElementById('tab-btn-'+(t==='administracion'?'admin':t)).classList.toggle('active', t===nombre);
  });
  if(nombre==='administracion'){
    document.getElementById('admin-msg').className = '';
    document.getElementById('admin-msg').textContent = '';
    cargarUsuarios();
  }
}

async function llamarAdmin(payload){
  const { data, error } = await supabaseClient.functions.invoke('admin-users', { body: payload });
  if(error){
    /* supabase-js entrega el cuerpo de la respuesta (con el mensaje real
       del servidor) dentro de error.context cuando la función respondió
       con un código de error controlado (400/401/403/etc.). */
    let detalle = error.message;
    try{
      const cuerpo = await error.context.json();
      if(cuerpo?.error) detalle = cuerpo.error;
    }catch(e){}
    throw new Error(detalle);
  }
  if(data?.error) throw new Error(data.error);
  return data;
}

function opcionesRol(rolActual){
  return Object.keys(ROLES_LABEL).map(r=>
    `<option value="${r}" ${rolActual===r?'selected':''}>${ROLES_LABEL[r]}</option>`
  ).join('');
}

async function cargarUsuarios(flashUserId){
  const cont = document.getElementById('admin-users-table');
  cont.innerHTML = '<span class="null">Cargando usuarios…</span>';
  try{
    const data = await llamarAdmin({ action:'list' });
    const filas = (data.usuarios||[]).map((u,i)=>{
      const esYo = u.id === currentUser.id;
      const estadoChip = u.deshabilitado
        ? '<span class="chip ei-no">Deshabilitado</span>'
        : '<span class="chip ei-yes">Activo</span>';
      const delay = Math.min(i*30, 300);
      return `<tr data-user-id="${u.id}" style="animation-delay:${delay}ms">
        <td class="vm">${esc(u.nombre)}<br><span class="null" style="font-size:12px">${esc(u.email)}</span>${esYo?' <span class="null">(tú)</span>':''}</td>
        <td>
          <select class="role-select" onchange="cambiarRolUsuario('${u.id}', this.value, this)" ${esYo?'title="Tu propia cuenta"':''}>
            ${u.role ? '' : '<option value="" selected disabled>Sin rol</option>'}
            ${opcionesRol(u.role)}
          </select>
        </td>
        <td>${estadoChip}</td>
        <td>${u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString('es-CO') : '<span class="null">Nunca</span>'}</td>
        <td>
          <button class="au-reset" onclick="toggleEstadoUsuario('${u.id}','${esc(u.nombre)}', ${u.deshabilitado})">${u.deshabilitado?'Habilitar':'Deshabilitar'}</button>
          <button class="au-reset" onclick="resetearPasswordUsuario('${u.id}','${esc(u.nombre)}', this)">Nueva clave</button>
          ${esYo?'':`<button class="au-del" onclick="eliminarUsuario('${u.id}','${esc(u.nombre)}', this)">Eliminar</button>`}
        </td>
      </tr>`;
    }).join('');
    cont.innerHTML = `
      <table class="admin-users-list">
        <thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th>Acciones</th></tr></thead>
        <tbody>${filas || '<tr><td colspan="5"><span class="null">Sin usuarios</span></td></tr>'}</tbody>
      </table>`;
    if(flashUserId){
      const fila = cont.querySelector(`tr[data-user-id="${flashUserId}"]`);
      if(fila) fila.classList.add('row-flash');
    }
  }catch(e){
    cont.innerHTML = '';
    adminMsg('⚠ ' + e.message, 'error');
  }
}

async function crearUsuario(){
  const nombre = document.getElementById('au-nombre').value.trim();
  const email = document.getElementById('au-email').value.trim();
  const password = document.getElementById('au-pass').value;
  const role = document.getElementById('au-role').value;
  const btn = document.getElementById('au-btn');
  if(!nombre || !email || !password){ adminMsg('Completa nombre, correo y contraseña.', 'error'); return; }

  btn.disabled = true;
  try{
    await llamarAdmin({ action:'create', email, password, nombre, role });
    adminMsg(`✓ Usuario "${nombre}" creado con rol ${ROLES_LABEL[role]||role}.`, 'ok');
    document.getElementById('au-nombre').value = '';
    document.getElementById('au-email').value = '';
    document.getElementById('au-pass').value = '';
    cargarUsuarios();
  }catch(e){
    adminMsg('⚠ ' + e.message, 'error');
  }finally{
    btn.disabled = false;
  }
}

async function toggleEstadoUsuario(userId, nombre, estaDeshabilitado){
  const habilitar = !!estaDeshabilitado;
  const verbo = habilitar ? 'habilitar' : 'deshabilitar';
  if(!confirm(`¿Seguro que quieres ${verbo} a "${nombre}"?`)) return;
  try{
    await llamarAdmin({ action:'setHabilitado', userId, habilitado: habilitar });
    adminMsg(`✓ Usuario "${nombre}" ${habilitar?'habilitado':'deshabilitado'}.`, 'ok');
    cargarUsuarios(userId);
  }catch(e){
    adminMsg('⚠ ' + e.message, 'error');
  }
}

async function cambiarRolUsuario(userId, nuevoRol, selectEl){
  const rolAnterior = selectEl.dataset.rolAnterior || null;
  try{
    await llamarAdmin({ action:'updateRole', userId, role: nuevoRol });
    adminMsg('✓ Rol actualizado.', 'ok');
    selectEl.dataset.rolAnterior = nuevoRol;
    /* Si el admin se cambia el rol a sí mismo (no debería poder, pero
       por si acaso), refresca sesión para reflejarlo. */
    if(userId === currentUser.id){
      currentRole = nuevoRol;
    }
  }catch(e){
    adminMsg('⚠ ' + e.message, 'error');
    if(rolAnterior) selectEl.value = rolAnterior;
    else cargarUsuarios();
  }
}

async function resetearPasswordUsuario(userId, username, btnEl){
  const nueva = prompt(`Nueva contraseña para "${username}" (mínimo 6 caracteres):`);
  if(!nueva) return;
  try{
    await llamarAdmin({ action:'resetPassword', userId, password: nueva });
    adminMsg(`✓ Contraseña de "${username}" actualizada.`, 'ok');
    const fila = btnEl ? btnEl.closest('tr') : null;
    if(fila){
      fila.classList.add('row-flash');
      setTimeout(()=>fila.classList.remove('row-flash'), 1000);
    }
  }catch(e){
    adminMsg('⚠ ' + e.message, 'error');
  }
}

async function eliminarUsuario(userId, username, btnEl){
  if(!confirm(`¿Eliminar al usuario "${username}"? Esta acción no se puede deshacer.`)) return;
  try{
    await llamarAdmin({ action:'delete', userId });
    adminMsg(`✓ Usuario "${username}" eliminado.`, 'ok');
    const fila = btnEl ? btnEl.closest('tr') : null;
    if(fila){
      fila.classList.add('row-removing');
      await new Promise(r=>setTimeout(r, 200));
    }
    cargarUsuarios();
  }catch(e){
    adminMsg('⚠ ' + e.message, 'error');
  }
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

/* Documentos (cartas de manifestación de intención de compra) ligados al
   FMI. buscar_folios devuelve un arreglo jsonb [{nombre, url}, ...]; un
   mismo folio puede tener más de un documento (o ninguno). */
function documentosHtml(docs){
  if(!Array.isArray(docs) || docs.length===0) return '<span class="null">Sin documento</span>';
  return docs.map((d,i)=>
    `<a class="map-link" href="${esc(d.url)}" target="_blank">${icon('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>')} Ver documento${docs.length>1?' '+(i+1):''}</a>`
  ).join('<br>');
}

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

    const rows=folios.map((f,i)=>{
      const delay=Math.min(i*30,300);
      const r=found.get(f.toUpperCase());
      if(!r){
        return `<tr class="row-empty" style="animation-delay:${delay}ms">
          <td class="vm">${esc(f)}</td>
          <td colspan="4"><span class="null">⚠ No se encontró este folio en la base de datos</span></td>
        </tr>`;
      }
      const esUnidad=!nul(r.codigo_subasta);
      const unidadHtml=esUnidad
        ?`<span class="chip cb">${esc(String(r.codigo_subasta).trim().toUpperCase())}</span>`
        :'<span class="null">No aplica</span>';
      const enlaceHtml=nul(r.enlace_inmueble)
        ?'<span class="null">No publicado</span>'
        :`<a class="map-link" href="${esc(r.enlace_inmueble)}" target="_blank">${icon('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>')} Ver inmueble</a>`;
      return `<tr style="animation-delay:${delay}ms">
        <td class="vm">${esc(fmtFmi(r.fmi))}</td>
        <td>${unidadHtml}</td>
        <td>${enlaceHtml}</td>
        <td>${dropdownInteres(r.interesados)}</td>
        <td>${documentosHtml(r.documentos)}</td>
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
            <th>Documento</th>
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
