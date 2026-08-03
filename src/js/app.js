/* ── AUTH ── */
let currentRole = null;
const CREDS = {
  'broker2026':   { pass:'Activos2026#$', role:'broker' },
  'comercial2026':{ pass:'2026', role:'comercial' },
  'SAE':          { pass:'SAE123456$%', role:'comercial' }
};

document.addEventListener('DOMContentLoaded',function(){
  document.getElementById('l-user').focus();
  ['l-user','l-pass'].forEach(id=>{
    document.getElementById(id).addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
  });
});

function doLogin(){
  const user = document.getElementById('l-user').value.trim();
  const pass = document.getElementById('l-pass').value;
  const err  = document.getElementById('l-err');
  const c    = CREDS[user];
  if(c && c.pass === pass){
    currentRole = c.role;
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('hero-eyebrow').textContent = 'CONSULTA DE EXPRESIONES DE INTERÉS · SAE · 2026';
  } else {
    err.style.display = 'block';
    document.getElementById('l-pass').value = '';
    document.getElementById('l-pass').focus();
  }
}

/* ── SUPABASE ── */
/* Mismo proyecto Supabase que VISTA; se agregaron 2 columnas nuevas a
   inventario_SAE: expresion_interes (boolean) y codigo_subasta (text).
   NOTA: la cantidad de expresiones de interés por folio (no solo Sí/No)
   está pendiente de un archivo fuente con el detalle por interesado;
   mientras tanto se muestra Sí/No según la columna booleana actual. */
const SUPABASE_URL='https://niemyawlnebylpidfefh.supabase.co';
const SUPABASE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pZW15YXdsbmVieWxwaWRmZWZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1OTAxNzUsImV4cCI6MjA5NDE2NjE3NX0.sUV59NOKURYE6kPDETaM_rddX_cDRltlu7xblC-OJF4';

document.getElementById('qi').addEventListener('keydown',e=>{if(e.key==='Enter' && !e.shiftKey){e.preventDefault();buscar();}});

function nul(v){return v===null||v===undefined||v==='';}
function fmt(v){if(nul(v))return '<span class="null">—</span>';return String(v);}
function esc(v){return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

function icon(path){return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">${path}</svg>`;}

/* Expresión de interés: cantidad de clientes/oferentes interesados,
   según la columna cantidad_expresion_interes (fuente: hoja
   SEMAFORO_ANALISTAS del inventario). 0 = sin expresiones de interés. */
function chipInteres(cantidad){
  const n = parseInt(cantidad,10) || 0;
  if(n<=0) return '<span class="chip ei-no">✕ Ninguna</span>';
  return `<span class="chip ei-yes">✓ ${n} expresión${n>1?'es':''} de interés</span>`;
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
  if(!raw)return;

  const folios=parseFolios(raw);
  if(folios.length===0)return;

  sb.style.display='block';sb.className='loading';
  sb.textContent=`⏳ Consultando ${folios.length} folio${folios.length>1?'s':''}...`;
  res.style.display='none';

  try{
    const inList=folios.map(f=>`"${f.replace(/"/g,'\\"')}"`).join(',');

    const [propResp,interesResp]=await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/inventario_SAE?fmi=in.(${inList})&select=fmi,codigo_subasta,enlace_inmueble`,{
        headers:{'apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`}
      }),
      fetch(`${SUPABASE_URL}/rest/v1/expresiones_interes?fmi=in.(${inList})&select=fmi`,{
        headers:{'apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`}
      })
    ]);
    if(!propResp.ok)throw new Error('HTTP '+propResp.status);
    if(!interesResp.ok)throw new Error('HTTP '+interesResp.status);
    const data=await propResp.json();
    const interesData=await interesResp.json();

    /* Cuenta cuántas veces aparece cada FMI en expresiones_interes
       (una fila = un cliente interesado). Se normaliza a mayúsculas para
       que no se pierdan coincidencias por diferencias de mayúsculas/
       minúsculas entre esta tabla e inventario_SAE (ej. "50c-..." vs "50C-..."). */
    const conteoInteres={};
    interesData.forEach(r=>{
      const k=String(r.fmi).toUpperCase();
      conteoInteres[k]=(conteoInteres[k]||0)+1;
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
        <td>${chipInteres(conteoInteres[String(r.fmi).toUpperCase()]||0)}</td>
      </tr>`;
    }).join('');

    res.innerHTML=`
    <div class="top-card">
      <div class="tc-left">
        <div class="tc-label">Resultado de la consulta</div>
        <div class="fmi-num" style="font-size:16px">${folios.length} folio${folios.length>1?'s':''} consultado${folios.length>1?'s':''}</div>
        <div class="tc-sub">${data.length} encontrado${data.length!==1?'s':''}${noEncontrados.length?` &nbsp;·&nbsp; ${noEncontrados.length} sin resultado`:''}</div>
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
