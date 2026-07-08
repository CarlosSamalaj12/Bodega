const token = localStorage.getItem("token");
const me = JSON.parse(localStorage.getItem("me") || "null");

if (!token) location.href = "/login";

const $ = (s) => document.querySelector(s);
let appWritePendingCount = 0;
let appWriteProgressValue = 0;
let appWriteProgressTimer = null;
let appWriteProgressShowTimer = null;

function setGlobalSaveProgress(value = 0) {
  const bar = $("#globalSaveProgressBar");
  if (!bar) return;
  const safe = Math.max(0, Math.min(100, Number(value || 0)));
  bar.style.width = `${safe}%`;
}

function showGlobalSaveProgress(label = "Guardando cambios...") {
  const box = $("#globalSaveProgress");
  const labelEl = $("#globalSaveProgressLabel");
  if (!box) return;
  if (labelEl) labelEl.textContent = String(label || "Guardando cambios...");
  box.classList.remove("hidden");
  box.classList.add("show");
  box.setAttribute("aria-hidden", "false");
}

function hideGlobalSaveProgress() {
  const box = $("#globalSaveProgress");
  if (!box) return;
  box.classList.remove("show");
  box.setAttribute("aria-hidden", "true");
  setTimeout(() => {
    if (appWritePendingCount > 0) return;
    box.classList.add("hidden");
  }, 220);
}


function getGlobalWriteLockButtons() {
  return Array.from(document.querySelectorAll([
    'button[id*="Save"]',
    'button[id*="ImportBtn"]',
    'button[id="bodLogoSave"]',
    'button[id="cuadreSavePdf"]'
  ].join(','))).filter((btn) => btn && !btn.closest('.hidden'));
}

function setGlobalWriteLockButtons(disabled) {
  getGlobalWriteLockButtons().forEach((btn) => {
    if (!btn.dataset) return;
    if (disabled) {
      if (!Object.prototype.hasOwnProperty.call(btn.dataset, 'lockedByGlobalWrite')) {
        btn.dataset.lockedByGlobalWrite = btn.disabled ? 'already' : '1';
      }
      btn.disabled = true;
      btn.classList.add('is-busy');
      if (!btn.dataset.originalBusyText) {
        btn.dataset.originalBusyText = String(btn.textContent || '').trim();
      }
      const original = String(btn.dataset.originalBusyText || '').trim();
      if (original && !/^guardando|^importando|^procesando/i.test(original)) {
        if (/import/i.test(original)) btn.textContent = 'Importando...';
        else if (/pdf/i.test(original)) btn.textContent = 'Preparando PDF...';
        else btn.textContent = 'Guardando...';
      }
      return;
    }
    const lockState = String(btn.dataset.lockedByGlobalWrite || '');
    if (!lockState) return;
    delete btn.dataset.lockedByGlobalWrite;
    btn.classList.remove('is-busy');
    if (btn.dataset.originalBusyText) {
      btn.textContent = btn.dataset.originalBusyText;
      delete btn.dataset.originalBusyText;
    }
    if (lockState !== 'already') btn.disabled = false;
  });
}

function startGlobalSaveProgress(label = "Guardando cambios...") {
  appWritePendingCount += 1;
  setGlobalWriteLockButtons(true);
  if (appWritePendingCount > 1) return;
  clearTimeout(appWriteProgressShowTimer);
  clearInterval(appWriteProgressTimer);
  appWriteProgressValue = 8;
  setGlobalSaveProgress(appWriteProgressValue);
  appWriteProgressShowTimer = setTimeout(() => {
    showGlobalSaveProgress(label);
    appWriteProgressTimer = setInterval(() => {
      appWriteProgressValue = Math.min(92, appWriteProgressValue + (appWriteProgressValue < 40 ? 10 : appWriteProgressValue < 70 ? 6 : 2.5));
      setGlobalSaveProgress(appWriteProgressValue);
    }, 220);
  }, 120);
}

function stopGlobalSaveProgress() {
  appWritePendingCount = Math.max(0, appWritePendingCount - 1);
  if (appWritePendingCount > 0) return;
  setGlobalWriteLockButtons(false);
  clearTimeout(appWriteProgressShowTimer);
  clearInterval(appWriteProgressTimer);
  appWriteProgressValue = 100;
  setGlobalSaveProgress(appWriteProgressValue);
  setTimeout(() => {
    setGlobalSaveProgress(0);
    hideGlobalSaveProgress();
  }, 260);
}

function shouldTrackGlobalSaveRequest(input, init = {}) {
  const method = String(init?.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return false;
  const url = String(typeof input === "string" ? input : input?.url || "");
  if (!url) return false;
  if (url.includes("/api/print/")) return false;
  if (url.includes("/api/session-policy")) return false;
  return url.startsWith("/api/") || url.includes("/api/");
}

function getGlobalSaveRequestLabel(input, init = {}) {
  const url = String(typeof input === "string" ? input : input?.url || "").toLowerCase();
  const method = String(init?.method || (typeof input === "object" && input?.method) || "POST").toUpperCase();
  if (url.includes("/api/usuarios")) return method === "POST" ? "Guardando usuario..." : "Actualizando usuario...";
  if (url.includes("/api/bodegas") && url.includes("/logo")) return "Guardando logo de bodega...";
  if (url.includes("/api/bodegas")) return method === "POST" ? "Guardando bodega..." : "Actualizando bodega...";
  if (url.includes("/api/productos")) return method === "POST" ? "Guardando producto..." : "Actualizando producto...";
  if (url.includes("/api/categorias")) return "Guardando categoria...";
  if (url.includes("/api/subcategorias")) return "Guardando subcategoria...";
  if (url.includes("/api/proveedores")) return "Guardando proveedor...";
  if (url.includes("/api/limites")) return "Guardando limite...";
  if (url.includes("/api/reglas-subcategorias")) return "Guardando regla...";
  if (url.includes("/api/orders")) return "Guardando pedido...";
  if (url.includes("/api/entradas")) return "Guardando entrada...";
  if (url.includes("/api/salidas")) return "Guardando salida...";
  if (url.includes("/api/ajustes")) return "Guardando ajuste...";
  if (url.includes("/api/cuadre-caja")) return "Guardando cuadre...";
  if (url.includes("/import") || url.includes("xlsx") || url.includes("csv")) return "Importando datos...";
  return method === "DELETE" ? "Procesando eliminacion..." : "Guardando cambios...";
}

const nativeFetch = window.fetch.bind(window);
window.fetch = async function(input, init) {
  const track = shouldTrackGlobalSaveRequest(input, init);
  if (track) startGlobalSaveProgress(getGlobalSaveRequestLabel(input, init));
  try {
    return await nativeFetch(input, init);
  } finally {
    if (track) stopGlobalSaveProgress();
  }
};



function normalizeAddViewsLayout(){
  try{
    const addViews=[
      'view-categorias','view-subcategorias','view-motivos-movimiento','view-proveedores',
      'view-productos','view-limites','view-reglas-subcategorias','view-usuarios','view-bodegas'
    ];
    const editSelectors=[
      '[id^="catEdit"]','[id^="subCatEdit"]','[id^="provEdit"]','[id^="prdEdit"]',
      '[id^="limEdit"]','[id^="regEdit"]','[id^="usrEdit"]','[id^="bodEdit"]'
    ].join(',');

    addViews.forEach((viewId)=>{
      const view=document.getElementById(viewId);
      const card=view?.querySelector('.card.light');
      if(!card) return;
      card.querySelectorAll(editSelectors).forEach((el)=>el.classList.remove('hidden'));

    });
  } catch (e) { console.error('processAddViewSections:', e); }
}

function applyAddViewButtonLabels(){
  try{
    const labels={
      entPrecioSugeridoChip:'Precio sugerido',
      catTemplateBtn:'Plantilla CSV',catImportBtn:'Importar CSV',catRefresh:'Actualizar',catSave:'Guardar categoria',catEditSave:'Guardar cambios',
      subCatTemplateBtn:'Plantilla CSV',subCatImportBtn:'Importar CSV',subCatRefresh:'Actualizar',subCatSave:'Guardar subcategoria',subCatEditSave:'Guardar cambios',
      motRefresh:'Actualizar',motSave:'Guardar motivo',
      provTemplateBtn:'Plantilla CSV',provImportBtn:'Importar CSV',provRefresh:'Actualizar',provSave:'Guardar proveedor',provEditSave:'Guardar cambios',
      prdSearchBtn:'Buscar',prdTemplateBtn:'Plantilla productos',prdImportBtn:'Importar productos',prdStockTemplateBtn:'Plantilla stock',prdStockImportBtn:'Importar stock',prdRefresh:'Actualizar',prdSave:'Guardar producto',
      limTemplateBtn:'Plantilla CSV',limImportBtn:'Importar CSV',limRefresh:'Actualizar',limSave:'Guardar limite',limEditSave:'Guardar cambios',
      regRefresh:'Actualizar',regSave:'Guardar regla',regEditSave:'Guardar cambios',
      usrAvatarClear:'Quitar avatar',usrRefresh:'Actualizar',usrSave:'Guardar usuario',usrResetOrderPinSave:'Guardar PIN',usrResetSave:'Guardar contrasena',usrPermReload:'Recargar',usrPermSave:'Guardar permisos',usrWhAccessReload:'Recargar',usrWhAccessSave:'Guardar accesos',usrEditAvatarClear:'Quitar avatar',usrEditSave:'Guardar cambios',
      bodLogoAppClear:'Quitar logo app',bodLogoPrintClear:'Quitar logo impresion',bodLogoSave:'Guardar logos',bodRefresh:'Actualizar',bodSave:'Guardar bodega',bodEditSave:'Guardar cambios',
      repPedClear:'Limpiar',repPedSearch:'Buscar',repPedExport:'Exportar',
      repKarClear:'Limpiar',repKarSearch:'Buscar',repKarExport:'Exportar',
      repExistClear:'Limpiar',repExistSearch:'Buscar',repExistExport:'Exportar',
      repAudClear:'Limpiar',repAudSearch:'Buscar'
    };
    Object.entries(labels).forEach(([id,text])=>{
      const el=document.getElementById(id);
      if(!el) return;
      if(!el.classList.contains('btn')) el.classList.add('btn','soft','btn-sm');
      if(!(el.textContent||'').trim()) el.textContent=text;
    });
  } catch (e) { console.error('clearCuadreDraftLocal:', e); }
}


function syncAdminCollapseState(section, expanded) {
  if (!section) return;
  section.classList.toggle('is-collapsed', !expanded);
  const toggle = section.querySelector('[data-admin-collapse-toggle]');
  if (toggle) toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

function initAdminAddCollapsibles() {
  document.querySelectorAll('[data-admin-collapse]').forEach((section) => {
    const expanded = !section.classList.contains('is-collapsed');
    syncAdminCollapseState(section, expanded);
  });
  if (document.body.dataset.adminCollapseBound === '1') return;
  document.body.addEventListener('click', (e) => {
    const toggle = e.target?.closest ? e.target.closest('[data-admin-collapse-toggle]') : null;
    if (!toggle) return;
    const section = toggle.closest('[data-admin-collapse]');
    if (!section) return;
    const expanded = section.classList.contains('is-collapsed');
    syncAdminCollapseState(section, expanded);
  });
  document.body.dataset.adminCollapseBound = '1';
}

function ensureTableWrapByBodyId(card, bodyId) {
  const body = card?.querySelector('#' + bodyId);
  if (!body) return;
  const table = body.closest('table');
  if (!table) return;
  if (table.closest('.tableWrap')) return;
  const wrap = document.createElement('div');
  wrap.className = 'tableWrap repTableScroll manageTableCompact';
  table.parentNode.insertBefore(wrap, table);
  wrap.appendChild(table);
}

function enforceCompactTableByBodyId(card, bodyId) {
  const body = card?.querySelector('#' + bodyId);
  if (!body) return;
  const wrap = body.closest('.tableWrap');
  if (!wrap) return;
  wrap.classList.add('repTableScroll', 'manageTableCompact');
}

function createAdminCollapseSection(title, bodyClass = '') {
  const sec = document.createElement('section');
  sec.className = 'repCollapseSection';
  sec.setAttribute('data-admin-collapse', '1');
  sec.innerHTML =
    '<button class="repCollapseToggle" data-admin-collapse-toggle type="button" aria-expanded="true">'
      + '<div class="repCollapseMeta"><div class="cardTitle">' + title + '</div></div>'
      + '<span class="repCollapseIcon" aria-hidden="true">&#9662;</span>'
    + '</button>'
    + '<div class="repCollapseBody"><div class="repCollapseBodyInner ' + bodyClass + '"></div></div>';
  return sec;
}

function resolveMovableNode(card, el) {
  if (!card || !el) return null;
  if (el.tagName === 'TBODY') return el.closest('.tableWrap') || el.closest('table') || el;

  const inSection = el.closest('[data-admin-collapse], [data-bod-collapse], .userSection');
  if (inSection) return null;

  const uiField = el.closest('.uiField');
  if (uiField && uiField.closest('.card.light') === card) return uiField;

  const gridField = el.closest('.grid2 > div, .grid3 > div, .grid4 > div');
  if (gridField && gridField.closest('.card.light') === card) return gridField;

  const actionRow = el.closest('.addRow, .actionRow');
  if (actionRow && actionRow.closest('.card.light') === card) {
    // Move only the requested control when an action row mixes buttons for different sections.
    if (el.id) return el;
    return actionRow;
  }

  const fileWrap = el.id && /FileName$/i.test(el.id) ? el.parentElement : null;
  if (fileWrap && fileWrap !== card && fileWrap.closest('.card.light') === card) return fileWrap;

  return el;
}

function moveIntoSection(card, section, ids) {
  const body = section.querySelector('.repCollapseBodyInner');
  if (!body) return;
  ids.forEach((id) => {
    const el = card.querySelector('#' + id);
    if (!el) return;
    const node = resolveMovableNode(card, el);
    if (!node || !node.parentNode) return;
    if (node === card || node.contains(body)) return;
    if (node.parentNode === body) return;
    if (node.closest('[data-admin-collapse], [data-bod-collapse], .userSection')) return;
    if (el.id && /FileName$/i.test(el.id) && node.classList) node.classList.add('note');
    body.appendChild(node);
  });
}

function moveIdsIntoContainer(card, container, ids) {
  if (!card || !container || !Array.isArray(ids)) return;
  ids.forEach((id) => {
    const el = card.querySelector('#' + id);
    if (!el) return;
    const node = resolveMovableNode(card, el);
    if (!node || !node.parentNode) return;
    if (node === card || node.contains(container)) return;
    if (node.parentNode === container) return;
    if (node.closest('[data-admin-collapse], [data-bod-collapse], .userSection')) return;
    container.appendChild(node);
  });
}
function createUserSection(title, bodyClass = '') {
  const sec = document.createElement('section');
  sec.className = 'userSection';
  sec.innerHTML =
    '<button class="userSectionToggle" data-user-acc-toggle type="button" aria-expanded="true">'
      + '<div class="cardTitle">' + title + '</div>'
      + '<span class="userSectionIcon" aria-hidden="true">&#9662;</span>'
    + '</button>'
    + '<div class="userSectionBody"><div class="' + bodyClass + '"></div></div>';
  return sec;
}

function createBodegaSection(title, bodyClass = '') {
  const sec = document.createElement('section');
  sec.className = 'repCollapseSection';
  sec.setAttribute('data-bod-collapse', '1');
  sec.innerHTML =
    '<button class="repCollapseToggle" data-bod-collapse-toggle type="button" aria-expanded="true">'
      + '<div class="repCollapseMeta"><div class="panelTitle">' + title + '</div></div>'
      + '<span class="repCollapseIcon" aria-hidden="true">&#9662;</span>'
    + '</button>'
    + '<div class="repCollapseBody"><div class="repCollapseBodyInner ' + bodyClass + '"></div></div>';
  return sec;
}

function openAdminCollapseSection(viewId, title) {
  const view = document.getElementById(viewId);
  if (!view) return;
  const section = Array.from(view.querySelectorAll('[data-admin-collapse]')).find((sec) => {
    const txt = sec.querySelector('.cardTitle, .panelTitle')?.textContent?.trim();
    return txt === title;
  });
  syncAdminCollapseState(section, true);
}


const IMPORT_SECTION_EXAMPLES = {
  'view-categorias:importar csv': ['nombre_categoria', 'activo (1=Activo, 0=Inactivo)'],
  'view-subcategorias:importar csv': ['nombre_subcategoria', 'categoria', 'activo (1/0)'],
  'view-proveedores:importar csv': ['nombre_proveedor', 'telefono', 'direccion', 'activo (1/0)'],
  'view-limites:importar csv': ['bodega', 'producto o sku', 'minimo', 'maximo', 'activo (1/0)'],
  'view-productos:importar productos': ['nombre_producto', 'sku', 'medida', 'categoria', 'subcategoria', 'activo (1/0)'],
  'view-productos:importar stock': ['sku o producto', 'bodega', 'cantidad', 'lote', 'caducidad (YYYY-MM-DD)', 'costo_unitario']
};

function getImportExampleLines(viewId, title) {
  const key = String(viewId || '') + ':' + String(title || '').trim().toLowerCase();
  return IMPORT_SECTION_EXAMPLES[key] || ['Revisa la plantilla CSV para el orden exacto de columnas.'];
}

function resolveImportNode(card, body, selector) {
  const el = body.querySelector(selector);
  if (!el) return null;
  const node = resolveMovableNode(card, el) || el;
  if (!node || node.closest('.adminImportBoard')) return null;
  return node;
}

function buildImportExampleCard(lines) {
  const card = document.createElement('div');
  card.className = 'adminImportCard adminImportCardExample';
  card.innerHTML = '<div class="adminImportCardTitle">Ejemplo de columnas</div>';
  const list = document.createElement('ul');
  list.className = 'adminImportExampleList';
  lines.forEach((line) => {
    const li = document.createElement('li');
    li.textContent = line;
    list.appendChild(li);
  });
  card.appendChild(list);
  return card;
}

function enhanceSingleImportSection(section) {
  if (!section) return;
  const body = section.querySelector('.repCollapseBodyInner');
  if (!body || body.dataset.importEnhanced === '1') return;

  const title = section.querySelector('.cardTitle, .panelTitle')?.textContent?.trim() || '';
  if (!/^importar/i.test(title)) return;

  const card = section.closest('.card.light');
  if (!card) return;

  const fileNode = resolveImportNode(card, body, 'input[type="file"]');
  const fileNameNode = resolveImportNode(card, body, '[id$="FileName"]');
  const delimiterNode = resolveImportNode(card, body, 'select[id$="Delimiter"], select[id*="Delimiter"]');
  const motivoNode = resolveImportNode(card, body, '#prdStockImportMotivo');
  const obsNode = resolveImportNode(card, body, '#prdStockImportObs');
  const templateBtn = resolveImportNode(card, body, 'button[id*="Template"]');
  const importBtn = resolveImportNode(card, body, 'button[id*="ImportBtn"]');
  const refreshBtn = resolveImportNode(card, body, 'button[id$="Refresh"]');

  const board = document.createElement('div');
  board.className = 'adminImportBoard';

  const uploadCard = document.createElement('div');
  uploadCard.className = 'adminImportCard adminImportCardUpload';
  uploadCard.innerHTML = '<div class="adminImportCardTitle">1. Subir archivo</div><div class="adminImportCardSub">Selecciona el CSV y valida que el nombre de columnas coincida con la plantilla.</div>';
  const drop = document.createElement('div');
  drop.className = 'adminImportDropZone';
  if (fileNode) drop.appendChild(fileNode);
  if (fileNameNode) drop.appendChild(fileNameNode);
  uploadCard.appendChild(drop);

  const configCard = document.createElement('div');
  configCard.className = 'adminImportCard adminImportCardConfig';
  configCard.innerHTML = '<div class="adminImportCardTitle">2. Configuracion</div><div class="adminImportCardSub">Define separador y campos de control antes de importar.</div>';
  const configBody = document.createElement('div');
  configBody.className = 'adminImportConfigGrid';
  if (delimiterNode) configBody.appendChild(delimiterNode);
  if (motivoNode) configBody.appendChild(motivoNode);
  if (obsNode) configBody.appendChild(obsNode);
  configCard.appendChild(configBody);

  const actionCard = document.createElement('div');
  actionCard.className = 'adminImportCard adminImportCardActions';
  actionCard.innerHTML = '<div class="adminImportCardTitle">3. Ejecutar</div><div class="adminImportCardSub">Descarga plantilla, carga datos y ejecuta importacion.</div>';
  const actions = document.createElement('div');
  actions.className = 'adminImportActionRow';
  if (templateBtn) actions.appendChild(templateBtn);
  if (importBtn) actions.appendChild(importBtn);
  if (refreshBtn) actions.appendChild(refreshBtn);
  actionCard.appendChild(actions);

  const viewId = section.closest('.view')?.id || '';
  const exampleCard = buildImportExampleCard(getImportExampleLines(viewId, title));

  board.appendChild(uploadCard);
  board.appendChild(configCard);
  board.appendChild(actionCard);
  board.appendChild(exampleCard);

  body.appendChild(board);
  body.dataset.importEnhanced = '1';
}

function enhanceAdminImportSections() {
  document.querySelectorAll('[data-admin-collapse]').forEach((section) => {
    try {
      enhanceSingleImportSection(section);
    } catch (err) {
      console.error('Error mejorando seccion de importacion', err);
    }
  });
}

function rebuildAddViewSections() {
  const viewMap = [
    {
      view:'view-categorias',
      sections:[
        {title:'Captura manual', desc:'Registra categorias una a una.', ids:['catNombre','catActivo','catSave','catRefresh']},
        {title:'Importar CSV', desc:'Sube archivo CSV usando plantilla y separador.', ids:['catImportFile','catImportFileName','catImportDelimiter','catTemplateBtn','catImportBtn']},
        {title:'Editar categoria', desc:'Completa los datos cargados desde el listado para actualizar.', ids:['catEditId','catEditNombre','catEditActivo','catEditSave']},
        {title:'Listado categorias', desc:'Consulta y administra categorias existentes.', ids:['catManageList']}
      ]
    },
    {
      view:'view-subcategorias',
      sections:[
        {title:'Captura manual', desc:'Crea subcategorias una por una.', ids:['subCatNombre','subCatCategoria','subCatActivo','subCatRefresh','subCatSave']},
        {title:'Importar CSV', desc:'Carga subcategorias masivamente desde plantilla.', ids:['subCatImportFile','subCatImportFileName','subCatImportDelimiter','subCatTemplateBtn','subCatImportBtn']},
        {title:'Editar subcategoria', desc:'Edita la subcategoria seleccionada desde el listado.', ids:['subCatEditId','subCatEditCategoria','subCatEditNombre','subCatEditActivo','subCatEditSave']},
        {title:'Listado subcategorias', desc:'Consulta y administra subcategorias.', ids:['subCatManageList']}
      ]
    },
    {
      view:'view-motivos-movimiento',
      sections:[
        {title:'Captura manual', desc:'Define motivos para entradas, salidas y ajustes.', ids:['motNombre','motTipo','motSigno','motActivo','motRefresh','motSave']},
        {title:'Listado motivos', desc:'Revisa los motivos existentes.', ids:['motList']}
      ]
    },
    {
      view:'view-proveedores',
      sections:[
        {title:'Captura manual', desc:'Registra proveedores uno por uno.', ids:['provNombre','provTelefono','provDireccion','provActivo','provRefresh','provSave']},
        {title:'Importar CSV', desc:'Carga proveedores desde archivo CSV.', ids:['provImportFile','provImportFileName','provImportDelimiter','provTemplateBtn','provImportBtn']},
        {title:'Editar proveedor', desc:'Actualiza proveedor seleccionado del listado.', ids:['provEditId','provEditNombre','provEditTelefono','provEditDireccion','provEditActivo','provEditSave']},
        {title:'Listado proveedores', desc:'Consulta y administra proveedores.', ids:['provManageList']}
      ]
    },
    {
      view:'view-limites',
      sections:[
        {title:'Captura manual', desc:'Configura limites minimo y maximo por bodega/producto.', ids:['limWarehouse','limProduct','limMin','limMax','limActive','limRefresh','limSave']},
        {title:'Importar CSV', desc:'Carga limites masivos con separador y plantilla.', ids:['limImportFile','limImportFileName','limImportDelimiter','limTemplateBtn','limImportBtn']},
        {title:'Editar limite', desc:'Edita un limite seleccionado desde el listado.', ids:['limEditWarehouse','limEditProduct','limEditWarehouseName','limEditProductName','limEditMin','limEditMax','limEditActive','limEditSave']},
        {title:'Listado limites', desc:'Consulta y administra limites.', ids:['limList']}
      ]
    },
    {
      view:'view-reglas-subcategorias',
      sections:[
        {title:'Captura manual', desc:'Define reglas por subcategoria.', ids:['regSubcat','regMaxDays','regAlertDays','regActive','regRefresh','regSave']},
        {title:'Editar regla', desc:'Ajusta la regla seleccionada desde el listado.', ids:['regEditSubcatId','regEditSubcatName','regEditMaxDays','regEditAlertDays','regEditActive','regEditSave']},
        {title:'Listado reglas', desc:'Consulta estado y vigencia de reglas.', ids:['regList']}
      ]
    }
  ];

  viewMap.forEach((cfg) => {
    try {
      const view = document.getElementById(cfg.view);
      const card = view?.querySelector('.card.light');
      if (!card || card.dataset.sectioned === '1') return;
      card.dataset.sectioned = '1';

      cfg.sections.forEach((secCfg, idx) => {
        try {
          const sec = createAdminCollapseSection(secCfg.title, 'adminSectionBody');
          if (idx > 0) sec.classList.add('is-collapsed');
          card.appendChild(sec);
          const body = sec.querySelector('.repCollapseBodyInner');
          if (secCfg.desc && body) {
            const hint = document.createElement('div');
            hint.className = 'note addSectionHint';
            hint.textContent = secCfg.desc;
            body.appendChild(hint);
          }
          moveIntoSection(card, sec, secCfg.ids);
        } catch (err) {
          console.error('Error creando seccion', cfg.view, secCfg?.title, err);
        }
      });
    } catch (err) {
      console.error('Error procesando vista', cfg.view, err);
    }
  });

  const prdView = document.getElementById('view-productos');
  const prdCardSection = prdView?.querySelector('.card.light');
  if (prdCardSection && prdCardSection.dataset.prdSectioned !== '1') {
    prdCardSection.dataset.prdSectioned = '1';
    const prdSections = [
      {
        title: 'Captura manual',
        desc: 'Paso 1: completa datos del producto, selecciona bodegas visibles y guarda.',
        ids: [
          'prdNombre','prdSku','prdMedida','prdActivo','prdCategoria','prdSubcategoria',
          'prdVisibleWarehouses','prdSave'
        ]
      },
      {
        title: 'Importar productos',
        desc: 'Carga masiva de catalogo de productos por CSV.',
        ids: ['prdImportFile','prdImportFileName','prdImportDelimiter','prdTemplateBtn','prdImportBtn']
      },
      {
        title: 'Importar stock',
        desc: 'Actualiza existencias por CSV con motivo y observacion.',
        ids: ['prdStockImportFile','prdStockImportFileName','prdStockImportDelimiter','prdStockImportMotivo','prdStockImportObs','prdStockTemplateBtn','prdStockImportBtn']
      },
      {
        title: 'Listado productos',
        desc: 'Paso 2: busca y consulta productos. Desde Accion puedes cargar uno para editar.',
        ids: ['prdSearch','prdSearchBtn','prdRefresh','prdManageList']
      },
      {
        title: 'Editar producto',
        desc: 'Paso 3: edita el producto seleccionado desde el listado y guarda cambios.',
        ids: ['prdEditId','prdEditNombre','prdEditSku','prdEditMedida','prdEditActivo','prdEditCategoria','prdEditSubcategoria','prdEditVisibleWarehouses','prdEditSave']
      }
    ];

    prdSections.forEach((cfg, idx) => {
      const sec = createAdminCollapseSection(cfg.title, 'adminSectionBody');
      if (cfg.title === 'Captura manual') sec.classList.add('prdCaptureSection');
      if (cfg.title === 'Listado productos') sec.classList.add('prdListSection');
      if (cfg.title === 'Editar producto') sec.classList.add('prdEditSection');
      if (idx > 0 && cfg.title !== 'Listado productos') sec.classList.add('is-collapsed');
      prdCardSection.appendChild(sec);
      const body = sec.querySelector('.repCollapseBodyInner');
      if (cfg.desc && body) {
        const hint = document.createElement('div');
        hint.className = 'note addSectionHint';
        hint.textContent = cfg.desc;
        body.appendChild(hint);
      }
      moveIntoSection(prdCardSection, sec, cfg.ids);
    });
  }
  const usrView = document.getElementById('view-usuarios');
  const usrCard = usrView?.querySelector('.card.light');
  if (usrCard && usrCard.dataset.userSectioned !== '1') {
    usrCard.dataset.userSectioned = '1';
    const usrSections = [
      {
        title: 'Crear usuario',
        ids: [
          'usrUsername', 'usrFullName', 'usrRole', 'usrWarehouse', 'usrPassword', 'usrOrderPin',
          'usrActive', 'usrCanSupervisor', 'usrNoAutoLogout',
          'usrAvatarFile', 'usrAvatarData', 'usrAvatarPreviewImg', 'usrAvatarPreviewFallback', 'usrAvatarClear',
          'usrRefresh', 'usrSave'
        ],
      },
      { title: 'Listado usuarios', ids: ['usrManageList'] },
      {
        title: 'Restablecer contrasena / PIN',
        ids: ['usrResetUser', 'usrResetPassword', 'usrResetPassword2', 'usrResetOrderPin', 'usrResetOrderPin2', 'usrResetOrderPinSave', 'usrResetSave'],
      },
      { title: 'Permisos de usuario', ids: ['usrPermUser', 'usrPermList', 'usrPermReload', 'usrPermSave'] },
      { title: 'Bodegas por usuario', ids: ['usrWhAccessUser', 'usrWhAccessList', 'usrWhAccessReload', 'usrWhAccessSave'] },
      {
        title: 'Editar usuario',
        ids: [
          'usrEditId', 'usrEditUsername', 'usrEditFullName', 'usrEditRole', 'usrEditWarehouse',
          'usrEditActive', 'usrEditCanSupervisor', 'usrEditNoAutoLogout',
          'usrEditAvatarData', 'usrEditAvatarFile', 'usrEditAvatarPreviewImg', 'usrEditAvatarPreviewFallback',
          'usrEditAvatarClear', 'usrEditSave'
        ],
      },
    ];
    usrSections.forEach((cfg, idx) => {
      const sec = createUserSection(cfg.title, 'adminSectionBody');
      if (idx > 0) sec.classList.add('is-collapsed');
      usrCard.appendChild(sec);
      moveIdsIntoContainer(usrCard, sec.querySelector('.userSectionBody > .adminSectionBody'), cfg.ids);
    });
  }

  const bodView = document.getElementById('view-bodegas');
  const bodCard = bodView?.querySelector('.card.light');
  if (bodCard && bodCard.dataset.bodSectioned !== '1') {
    bodCard.dataset.bodSectioned = '1';
    const bodSections = [
      {
        title: 'Datos de bodega',
        ids: [
          'bodNombre', 'bodTipo', 'bodTelefono', 'bodDireccion', 'bodActivo',
          'bodStock', 'bodRecibir', 'bodDespachar', 'bodModo', 'bodDestino', 'bodConteoFinal', 'bodPrecioSalida',
          'bodRefresh', 'bodSave'
        ],
      },
      { title: 'Listado bodegas', ids: ['bodManageList'] },
      {
        title: 'Editar bodega',
        ids: [
          'bodEditId', 'bodEditNombre', 'bodEditTipo', 'bodEditTelefono', 'bodEditDireccion',
          'bodEditActivo', 'bodEditStock', 'bodEditRecibir', 'bodEditDespachar', 'bodEditModo', 'bodEditDestino',
          'bodEditConteoFinal', 'bodEditPrecioSalida',
          'bodLogoAppFile', 'bodLogoAppData', 'bodLogoAppPreviewImg', 'bodLogoAppPreviewFallback', 'bodLogoAppClear',
          'bodLogoPrintFile', 'bodLogoPrintData', 'bodLogoPrintPreviewImg', 'bodLogoPrintPreviewFallback', 'bodLogoPrintClear',
          'bodLogoSave', 'bodEditSave'
        ],
      },
    ];
    bodSections.forEach((cfg, idx) => {
      const sec = createBodegaSection(cfg.title, 'adminSectionBody');
      if (idx > 0) sec.classList.add('is-collapsed');
      bodCard.appendChild(sec);
      const body = sec.querySelector('.repCollapseBodyInner');
      if (cfg.title === 'Editar bodega' && body && !body.querySelector('#bodEditSummary')) {
        const hint = document.createElement('div');
        hint.className = 'note addSectionHint';
        hint.textContent = 'Selecciona una bodega del listado para cargar sus datos. En este mismo panel puedes editar informacion, cambiar logos y guardar todo.';
        body.appendChild(hint);

        const summary = document.createElement('div');
        summary.className = 'warehouseEditSummary';
        summary.id = 'bodEditSummary';
        summary.innerHTML = '<div class="warehouseEditSummaryTitle">Ninguna bodega seleccionada</div><div class="warehouseEditSummaryMeta">Presiona el boton editar en el listado para cargar la informacion aqui.</div>';
        body.appendChild(summary);
      }
      moveIdsIntoContainer(bodCard, body, cfg.ids);
    });
  }

  // Listas administrativas: alto compacto + scroll interno
  const tableMaps = [
    { card: document.querySelector('#view-categorias .card.light'), ids: ['catManageList'] },
    { card: document.querySelector('#view-subcategorias .card.light'), ids: ['subCatManageList'] },
    { card: document.querySelector('#view-motivos-movimiento .card.light'), ids: ['motList'] },
    { card: document.querySelector('#view-proveedores .card.light'), ids: ['provManageList'] },
    { card: document.querySelector('#view-productos .card.light'), ids: ['prdManageList'] },
    { card: document.querySelector('#view-limites .card.light'), ids: ['limList'] },
    { card: document.querySelector('#view-reglas-subcategorias .card.light'), ids: ['regList'] },
    { card: document.querySelector('#view-bodegas .card.light'), ids: ['bodManageList'] },
    { card: document.querySelector('#view-usuarios .card.light'), ids: ['usrManageList', 'usrPermList', 'usrWhAccessList'] }
  ];
  tableMaps.forEach(({ card, ids }) => {
    if (!card) return;
    ids.forEach((id) => {
      ensureTableWrapByBodyId(card, id);
      enforceCompactTableByBodyId(card, id);
    });
  });

  initAdminAddCollapsibles();
  initUserAccordions();
  initBodegasCollapsibles();
  ensureDynamicFieldLabels();
  applyUiHelpTooltips(document);
  enhanceAdminImportSections();
}

function safeRebuildAddViewSections() {
  try {
    rebuildAddViewSections();
    applyUiHelpTooltips(document);
  } catch (e) {
    console.error('Error en rebuildAddViewSections:', e);
  }
}

function ensureNativeUiClasses(){
  try{
    const addViewIds = new Set([
      'view-categorias','view-subcategorias','view-motivos-movimiento','view-proveedores',
      'view-productos','view-limites','view-reglas-subcategorias','view-usuarios','view-bodegas'
    ]);
    addViewIds.forEach((id) => {
      const card = document.querySelector('#' + id + ' .card.light');
      if (card) card.classList.add('addViewCard');
    });

    const fileIds = [
      'usrAvatarFile','usrEditAvatarFile','bodLogoAppFile','bodLogoPrintFile',
      'catImportFile','subCatImportFile','provImportFile','prdImportFile','prdStockImportFile','limImportFile'
    ];
    fileIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.add('avatarFile');
    });

    const avatarPreviewImgIds = ['usrAvatarPreviewImg','usrEditAvatarPreviewImg'];
    const avatarPreviewFallbackIds = ['usrAvatarPreviewFallback','usrEditAvatarPreviewFallback'];
    const logoPreviewImgIds = ['bodLogoAppPreviewImg','bodLogoPrintPreviewImg'];
    const logoPreviewFallbackIds = ['bodLogoAppPreviewFallback','bodLogoPrintPreviewFallback'];
    avatarPreviewImgIds.forEach((id) => document.getElementById(id)?.classList.add('avatarPreviewImg'));
    avatarPreviewFallbackIds.forEach((id) => document.getElementById(id)?.classList.add('avatarPreviewFallback'));
    logoPreviewImgIds.forEach((id) => document.getElementById(id)?.classList.add('logoPreviewImg'));
    logoPreviewFallbackIds.forEach((id) => document.getElementById(id)?.classList.add('logoPreviewFallback'));

    const scope = document.querySelectorAll('.card.light, .modalCard');
    scope.forEach((root)=>{
      root.querySelectorAll('input, select, textarea').forEach((el)=>{
        const tag = (el.tagName || '').toLowerCase();
        const type = String(el.getAttribute('type') || '').toLowerCase();
        if (tag === 'textarea') {
          if (!el.classList.contains('ta')) el.classList.add('ta');
          return;
        }
        if (tag === 'input' && (type === 'hidden' || type === 'checkbox' || type === 'radio' || type === 'file')) return;
        if (!el.classList.contains('in')) el.classList.add('in');
      });

      // Only normalize known action buttons. Do NOT touch cards/icon buttons.
      root.querySelectorAll('button[id]').forEach((btn)=>{
        if (btn.classList.contains('btn')) return;
        if (btn.classList.contains('homeDashCard') || btn.classList.contains('iconBtn') || btn.classList.contains('iconBtnSm')) return;
        if (btn.closest('tbody') || btn.closest('thead')) return;
        btn.classList.add('btn','soft','btn-sm');
      });
    });
  } catch (e) { console.error('saveCuadreDraftLocal:', e); }
}
function applyAddFieldHints(){
  try{
    const placeholders={
      catNombre:'Nombre categoria',
      subCatNombre:'Nombre subcategoria',
      motNombre:'Nombre motivo',
      provNombre:'Nombre proveedor',provTelefono:'Telefono',provDireccion:'Direccion',
      prdNombre:'Nombre producto',prdSku:'SKU',prdSearch:'Buscar producto...',prdStockImportObs:'Observacion importacion',
      limMin:'Minimo',limMax:'Maximo',
      regMaxDays:'Dias maximos',regAlertDays:'Dias alerta',
      usrUsername:'Usuario',usrFullName:'Nombre completo',usrPassword:'Contrasena',usrOrderPin:'PIN pedidos',
      usrResetPassword:'Nueva contrasena',usrResetPassword2:'Confirmar contrasena',usrResetOrderPin:'Nuevo PIN',usrResetOrderPin2:'Confirmar PIN',
      bodNombre:'Nombre bodega',bodTelefono:'Telefono',bodDireccion:'Direccion'
    };
    Object.entries(placeholders).forEach(([id,text])=>{
      const el=document.getElementById(id);
      if(!el) return;
      if(!el.getAttribute('placeholder')) el.setAttribute('placeholder',text);
    });

    const selects={
      catActivo:'Seleccione estado',
      subCatCategoria:'Seleccione categoria',subCatActivo:'Seleccione estado',
      motTipo:'Seleccione tipo',motSigno:'Seleccione signo',motActivo:'Seleccione estado',
      provActivo:'Seleccione estado',provImportDelimiter:'Seleccione separador',
      prdMedida:'Seleccione medida',prdActivo:'Seleccione estado',prdCategoria:'Seleccione categoria',prdSubcategoria:'Seleccione subcategoria',prdImportDelimiter:'Seleccione separador',prdStockImportDelimiter:'Seleccione separador',prdStockImportMotivo:'Seleccione motivo',
      limWarehouse:'Seleccione bodega',limProduct:'Seleccione producto',limActive:'Seleccione estado',limImportDelimiter:'Seleccione separador',
      regSubcat:'Seleccione subcategoria',regActive:'Seleccione estado',
      usrRole:'Seleccione rol',usrWarehouse:'Seleccione bodega',usrActive:'Seleccione estado',usrCanSupervisor:'Seleccione opcion',usrNoAutoLogout:'Seleccione opcion',usrResetUser:'Seleccione usuario',usrPermUser:'Seleccione usuario',usrWhAccessUser:'Seleccione usuario',
      bodTipo:'Seleccione tipo',bodActivo:'Seleccione estado',bodStock:'Maneja stock',bodRecibir:'Puede recibir',bodDespachar:'Puede despachar',bodModo:'Modo despacho',bodDestino:'Bodega destino',bodConteoFinal:'Permite conteo final',bodPrecioSalida:'Requiere precio salida',bodEditTipo:'Seleccione tipo',bodEditActivo:'Seleccione estado',bodEditStock:'Maneja stock',bodEditRecibir:'Puede recibir',bodEditDespachar:'Puede despachar',bodEditModo:'Modo despacho',bodEditDestino:'Bodega destino',bodEditConteoFinal:'Permite conteo final',bodEditPrecioSalida:'Requiere precio salida'
    };
    Object.entries(selects).forEach(([id,label])=>{
      const sel=document.getElementById(id);
      if(!sel || sel.tagName!=='SELECT') return;
      const first=sel.options && sel.options.length ? sel.options[0] : null;
      if (!first || (first.value!=='' && first.textContent.trim()!==label)) {
        const opt=document.createElement('option');
        opt.value='';
        opt.textContent=label;
        sel.insertBefore(opt, sel.firstChild || null);
      } else if (first && !first.textContent.trim()) {
        first.textContent=label;
      }
    });
  } catch (e) { console.error('applyAddFieldHints:', e); }
}

function ensureStaticSelectCatalogs() {
  try {
    const staticSelects = {
      catActivo: [
        { value: "1", label: "Activo" },
        { value: "0", label: "Inactivo" }
      ],
      subCatActivo: [
        { value: "1", label: "Activo" },
        { value: "0", label: "Inactivo" }
      ],
      motTipo: [
        { value: "ENTRADA", label: "Entrada" },
        { value: "SALIDA", label: "Salida" },
        { value: "AJUSTE", label: "Ajuste" }
      ],
      motSigno: [
        { value: "1", label: "Suma (+)" },
        { value: "-1", label: "Resta (-)" }
      ],
      motActivo: [
        { value: "1", label: "Activo" },
        { value: "0", label: "Inactivo" }
      ],
      provActivo: [
        { value: "1", label: "Activo" },
        { value: "0", label: "Inactivo" }
      ],
      prdActivo: [
        { value: "1", label: "Activo" },
        { value: "0", label: "Inactivo" }
      ],
      limActive: [
        { value: "1", label: "Activo" },
        { value: "0", label: "Inactivo" }
      ],
      limEditActive: [
        { value: "1", label: "Activo" },
        { value: "0", label: "Inactivo" }
      ],
      regActive: [
        { value: "1", label: "Activo" },
        { value: "0", label: "Inactivo" }
      ],
      usrActive: [
        { value: "1", label: "Activo" },
        { value: "0", label: "Inactivo" }
      ],
      usrCanSupervisor: [
        { value: "1", label: "Si" },
        { value: "0", label: "No" }
      ],
      usrNoAutoLogout: [
        { value: "0", label: "No" },
        { value: "1", label: "Si" }
      ],
      usrEditActive: [
        { value: "1", label: "Activo" },
        { value: "0", label: "Inactivo" }
      ],
      usrEditCanSupervisor: [
        { value: "1", label: "Si" },
        { value: "0", label: "No" }
      ],
      usrEditNoAutoLogout: [
        { value: "0", label: "No" },
        { value: "1", label: "Si" }
      ],
      bodTipo: [
        { value: "DESPACHO", label: "Despacho / Principal" },
        { value: "OPERATIVA", label: "Operativa" },
        { value: "RECEPTORA", label: "Receptora" },
        { value: "PRINCIPAL", label: "Principal" }
      ],
      bodActivo: [
        { value: "1", label: "Activa" },
        { value: "0", label: "Inactiva" }
      ],
      bodStock: [
        { value: "1", label: "Si" },
        { value: "0", label: "No" }
      ],
      bodRecibir: [
        { value: "1", label: "Si" },
        { value: "0", label: "No" }
      ],
      bodDespachar: [
        { value: "1", label: "Si" },
        { value: "0", label: "No" }
      ],
      bodModo: [
        { value: "SALIDA", label: "Salida" },
        { value: "TRANSFERENCIA", label: "Transferencia" }
      ],
      bodConteoFinal: [
        { value: "1", label: "Si" },
        { value: "0", label: "No" }
      ],
      bodPrecioSalida: [
        { value: "1", label: "Si" },
        { value: "0", label: "No" }
      ],
      bodEditTipo: [
        { value: "DESPACHO", label: "Despacho / Principal" },
        { value: "OPERATIVA", label: "Operativa" },
        { value: "RECEPTORA", label: "Receptora" },
        { value: "PRINCIPAL", label: "Principal" }
      ],
      bodEditActivo: [
        { value: "1", label: "Activa" },
        { value: "0", label: "Inactiva" }
      ],
      bodEditStock: [
        { value: "1", label: "Si" },
        { value: "0", label: "No" }
      ],
      bodEditRecibir: [
        { value: "1", label: "Si" },
        { value: "0", label: "No" }
      ],
      bodEditDespachar: [
        { value: "1", label: "Si" },
        { value: "0", label: "No" }
      ],
      bodEditModo: [
        { value: "SALIDA", label: "Salida" },
        { value: "TRANSFERENCIA", label: "Transferencia" }
      ],
      bodEditConteoFinal: [
        { value: "1", label: "Si" },
        { value: "0", label: "No" }
      ],
      bodEditPrecioSalida: [
        { value: "1", label: "Si" },
        { value: "0", label: "No" }
      ],
      repPedDateMode: [
        { value: "PEDIDO", label: "Fecha pedido" },
        { value: "DESPACHO", label: "Fecha despacho" }
      ],
      repKarTipo: [
        { value: "", label: "Todos los tipos" },
        { value: "ENTRADA", label: "Entrada" },
        { value: "SALIDA", label: "Salida" },
        { value: "TRANSFERENCIA", label: "Transferencia" }
      ]
    };

    Object.entries(staticSelects).forEach(([id, options]) => {
      const sel = document.getElementById(id);
      if (!sel || sel.tagName !== 'SELECT') return;

      const desiredValues = new Set(options.map((x) => String(x.value)));
      const existing = Array.from(sel.options || []);
      const hasDesired = existing.some((o) => desiredValues.has(String(o.value)));
      if (hasDesired) return;

      const first = existing[0];
      const keepPlaceholder = first && String(first.value || '') === '';
      const prevValue = String(sel.value || '');
      const html = [];
      if (keepPlaceholder) {
        html.push(`<option value="">${first.textContent || 'Seleccione'}</option>`);
      }
      options.forEach((opt) => {
        html.push(`<option value="${String(opt.value)}">${opt.label}</option>`);
      });
      sel.innerHTML = html.join('');

      if (prevValue && desiredValues.has(prevValue)) {
        sel.value = prevValue;
      } else if (!keepPlaceholder && options.length) {
        sel.value = String(options[0].value);
      }
    });
  } catch (e) { console.error('api_usuarios:', e); }
}
const UI_FIELD_LABELS = {
  catNombre: 'Nombre categoria',
  catActivo: 'Estado',
  catImportFile: 'Archivo CSV',
  catImportDelimiter: 'Separador CSV',
  subCatNombre: 'Nombre subcategoria',
  subCatCategoria: 'Categoria',
  subCatActivo: 'Estado',
  subCatImportFile: 'Archivo CSV',
  subCatImportDelimiter: 'Separador CSV',
  motNombre: 'Nombre motivo',
  motTipo: 'Tipo',
  motSigno: 'Signo',
  motActivo: 'Estado',
  provNombre: 'Nombre proveedor',
  provTelefono: 'Telefono',
  provDireccion: 'Direccion',
  provActivo: 'Estado',
  provImportFile: 'Archivo CSV',
  provImportDelimiter: 'Separador CSV',
  prdNombre: 'Nombre producto',
  prdSku: 'SKU',
  prdMedida: 'Medida',
  prdCategoria: 'Categoria',
  prdSubcategoria: 'Subcategoria',
  prdActivo: 'Estado',
  prdImportFile: 'Archivo productos',
  prdImportDelimiter: 'Separador importacion',
  prdStockImportFile: 'Archivo stock',
  prdStockImportDelimiter: 'Separador stock',
  prdStockImportMotivo: 'Motivo stock',
  prdStockImportObs: 'Observacion',
  limWarehouse: 'Bodega',
  limProduct: 'Producto',
  limMin: 'Minimo',
  limMax: 'Maximo',
  limActive: 'Estado',
  limEditWarehouseName: 'Bodega',
  limEditProductName: 'Producto',
  limEditMin: 'Minimo',
  limEditMax: 'Maximo',
  limEditActive: 'Estado',
  limImportFile: 'Archivo CSV',
  limImportDelimiter: 'Separador CSV',
  regSubcat: 'Subcategoria',
  regMaxDays: 'Dias maximos',
  regAlertDays: 'Dias alerta',
  regActive: 'Estado',
  usrUsername: 'Usuario',
  usrFullName: 'Nombre completo',
  usrRole: 'Rol',
  usrWarehouse: 'Bodega',
  usrPassword: 'Contrasena',
  usrOrderPin: 'PIN pedidos',
  usrActive: 'Estado',
  usrCanSupervisor: 'Puede supervisar',
  usrNoAutoLogout: 'Sin auto logout',
  usrAvatarFile: 'Avatar',
  usrResetUser: 'Usuario',
  usrResetPassword: 'Nueva contrasena',
  usrResetPassword2: 'Confirmar contrasena',
  usrResetOrderPin: 'Nuevo PIN',
  usrResetOrderPin2: 'Confirmar PIN',
  usrPermUser: 'Usuario',
  usrWhAccessUser: 'Usuario',
  usrEditUsername: 'Usuario',
  usrEditFullName: 'Nombre completo',
  usrEditRole: 'Rol',
  usrEditWarehouse: 'Bodega',
  usrEditActive: 'Estado',
  usrEditCanSupervisor: 'Puede supervisar',
  usrEditNoAutoLogout: 'Sin auto logout',
  usrEditAvatarFile: 'Avatar',
  bodNombre: 'Nombre bodega',
  bodTipo: 'Tipo',
  bodTelefono: 'Telefono',
  bodDireccion: 'Direccion',
  bodActivo: 'Estado',
  bodStock: 'Maneja stock',
  bodRecibir: 'Puede recibir',
  bodDespachar: 'Puede despachar',
  bodModo: 'Modo despacho',
  bodDestino: 'Destino default',
  bodConteoFinal: 'Permite conteo final',
  bodPrecioSalida: 'Requiere precio salida',
  bodLogoAppFile: 'Logo app',
  bodLogoPrintFile: 'Logo impresion',
  bodEditNombre: 'Nombre bodega',
  bodEditTipo: 'Tipo',
  bodEditTelefono: 'Telefono',
  bodEditDireccion: 'Direccion',
  bodEditActivo: 'Estado',
  bodEditStock: 'Maneja stock',
  bodEditRecibir: 'Puede recibir',
  bodEditDespachar: 'Puede despachar',
  bodEditModo: 'Modo despacho',
  bodEditDestino: 'Destino default',
  bodEditConteoFinal: 'Permite conteo final',
  bodEditPrecioSalida: 'Requiere precio salida',
  repPedId: 'Pedido',
  repPedEstado: 'Estado',
  repPedDateFrom: 'Desde',
  repPedDateTo: 'Hasta',
  repPedDateMode: 'Tipo de fecha',
  repPedWarehouseReq: 'Bodega solicitante',
  repPedWarehouseDesp: 'Bodega despacho',
  repPedRequesterUser: 'Solicitante',
  repPedDispatchUser: 'Usuario despacho',
  repPedCategoria: 'Categoria',
  repPedSubcategoria: 'Subcategoria',
  repPedLote: 'Lote',
  repPedPickProduct: 'Producto',
  repKarWarehouse: 'Bodega',
  repKarDateFrom: 'Desde',
  repKarDateTo: 'Hasta',
  repKarTipo: 'Tipo',
  repKarMovimiento: 'Movimiento',
  repKarCategoria: 'Categoria',
  repKarSubcategoria: 'Subcategoria',
  repKarUsuario: 'Usuario',
  repKarSolicitante: 'Solicitante',
  repKarDocumento: 'Documento',
  repKarLote: 'Lote',
  repKarPickProduct: 'Producto',
  repExistWarehouse: 'Bodega',
  repExistCategoria: 'Categoria',
  repExistSubcategoria: 'Subcategoria',
  repExistPickProduct: 'Producto',
  repAudDateFrom: 'Desde',
  repAudDateTo: 'Hasta',
  repAudAction: 'Accion',
  repAudQuery: 'Busqueda'
};

function buildUiFieldLabel(id = '') {
  const text = String(id || '').replace(/^[^A-Za-z]+/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
  return text
    .replace(/_/g, ' ')
    .replace(/\b(id|usr|bod|rep|cat|prd|lim|reg|mot|prov)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function ensureUiFieldLabel(el) {
  if (!el || !el.id) return;
  const tag = String(el.tagName || '').toLowerCase();
  const type = String(el.getAttribute('type') || '').toLowerCase();
  if (!['input', 'select', 'textarea'].includes(tag)) return;
  if (type === 'hidden' || type === 'checkbox' || type === 'radio') return;
  if (el.classList?.contains('hidden') || el.closest('.hidden')) return;

  if (/(Data)$/i.test(el.id) || el.id === 'usrEditId' || el.id === 'bodEditId' || el.id === 'regEditSubcatId') return;
  if (el.closest('table') || el.closest('.tableWrap') || el.closest('.searchWrap')) return;
  if (el.closest('.uiField')) return;
  const prev = el.previousElementSibling;
  if (prev && prev.classList && prev.classList.contains('lbl')) return;

  const parent = el.parentElement;
  if (!parent || parent.tagName === 'LABEL') return;

  const labelText = UI_FIELD_LABELS[el.id] || buildUiFieldLabel(el.id) || 'Campo';
  const field = document.createElement('div');
  field.className = 'uiField';
  parent.insertBefore(field, el);

  const lbl = document.createElement('label');
  lbl.className = 'lbl';
  lbl.setAttribute('for', el.id);
  lbl.textContent = labelText;

  field.appendChild(lbl);
  field.appendChild(el);
}

function ensureDynamicFieldLabels() {
  const scopes = [
    '#view-categorias .card.light',
    '#view-subcategorias .card.light',
    '#view-motivos-movimiento .card.light',
    '#view-proveedores .card.light',
    '#view-productos .card.light',
    '#view-limites .card.light',
    '#view-reglas-subcategorias .card.light',
    '#view-usuarios .card.light',
    '#view-bodegas .card.light',
    '#view-r-pedidos .card.light',
    '#view-r-transferencias .card.light',
    '#view-r-existencias .card.light',
    '#view-r-auditoria-sensibles .card.light'
  ];
  scopes.forEach((sel) => {
    const root = document.querySelector(sel);
    if (!root) return;
    root.querySelectorAll('input[id],select[id],textarea[id]').forEach(ensureUiFieldLabel);
  });
}

const UI_HELP_HINTS = {
  prdSearch: "Escribe parte del nombre o SKU y presiona Buscar.",
  prdVisibleWarehouses: "Marca las bodegas donde el producto estara disponible.",
  prdEditVisibleWarehouses: "Filtra y selecciona rapidamente bodegas para este producto.",
  limMin: "Define el stock minimo permitido para alertas.",
  limMax: "Define el stock maximo recomendado.",
  repPedDateFrom: "Selecciona la fecha inicial del filtro.",
  repPedDateTo: "Selecciona la fecha final del filtro.",
  repKarDateFrom: "Selecciona la fecha inicial del periodo.",
  repKarDateTo: "Selecciona la fecha final del periodo.",
  repExistPickProduct: "Busca por nombre o SKU para filtrar existencias.",
  usrOrderPin: "PIN utilizado para validar acciones de pedidos.",
  usrResetOrderPin: "Nuevo PIN numerico para pedidos.",
  bodDestino: "Bodega destino por defecto para transferencias.",
  bodEditDestino: "Bodega destino por defecto para esta bodega."
};

function getClosestHelpSectionTitle(el) {
  const sec = el?.closest?.('[data-admin-collapse], [data-bod-collapse], .userSection');
  if (!sec) return '';
  const titleEl = sec.querySelector('.cardTitle, .panelTitle');
  return String(titleEl?.textContent || '').trim();
}

function getControlHelpLabel(el) {
  if (!el) return '';
  if (el.classList?.contains('lbl')) {
    return String(el.textContent || '').trim();
  }
  const id = String(el.id || '').trim();
  if (id && UI_FIELD_LABELS[id]) return UI_FIELD_LABELS[id];
  const uiLabel = el.closest('.uiField')?.querySelector('.lbl');
  if (uiLabel) return String(uiLabel.textContent || '').trim();
  const prev = el.previousElementSibling;
  if (prev?.classList?.contains('lbl')) return String(prev.textContent || '').trim();
  if (id) {
    const lbl = document.querySelector('label[for="' + id + '"]');
    if (lbl) return String(lbl.textContent || '').trim();
  }
  const txt = String(el.textContent || '').trim();
  if (txt) return txt;
  if (id) return buildUiFieldLabel(id);
  return 'Elemento';
}

function buildControlHelpText(el, labelText, sectionTitle) {
  const tag = String(el?.tagName || '').toLowerCase();
  const type = String(el?.getAttribute?.('type') || '').toLowerCase();
  const id = String(el?.id || '').trim();
  const sectionInfo = sectionTitle ? (' Seccion: ' + sectionTitle + '.') : '';

  if (tag === 'button') {
    return 'Accion: ' + labelText + '. Presiona para ejecutar esta opcion.' + sectionInfo;
  }
  if (tag === 'label') {
    return 'Campo: ' + labelText + '. Coloca el cursor en el control asociado para editarlo.' + sectionInfo;
  }
  if (type === 'file') {
    return 'Campo: ' + labelText + '. Selecciona un archivo valido para continuar.' + sectionInfo;
  }
  const specific = id && UI_HELP_HINTS[id] ? (' ' + UI_HELP_HINTS[id]) : ' Completa este campo y luego guarda o busca segun corresponda.';
  return 'Campo: ' + labelText + '.' + specific + sectionInfo;
}

function applyUiHelpTooltips(root = document) {
  try {
    const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    scope.querySelectorAll('button.iconBtn:not([title]), button.iconBtnSm:not([title]), button.dispatchBtn:not([title]), button.dispatchActionIcon:not([title])').forEach((btn) => {
      const txt = String(btn.textContent || '').trim();
      if (txt === 'E') btn.setAttribute('title', 'Editar registro');
      else if (txt === 'X') btn.setAttribute('title', 'Eliminar o desactivar registro');
      else if (txt === 'H') btn.setAttribute('title', 'Habilitar en mi bodega');
      else if (txt === '+') btn.setAttribute('title', 'Incrementar cantidad');
      else if (txt === '-') btn.setAttribute('title', 'Disminuir cantidad');
      else btn.setAttribute('title', 'Accion rapida');
    });

    scope.querySelectorAll('[data-admin-collapse-toggle], [data-bod-collapse-toggle], [data-user-acc-toggle]').forEach((toggle) => {
      if (toggle.getAttribute('title')) return;
      const section = toggle.closest('[data-admin-collapse], [data-bod-collapse], .userSection');
      const hint = String(section?.querySelector('.addSectionHint')?.textContent || '').trim();
      const base = 'Haz clic para abrir o cerrar esta seccion.';
      toggle.setAttribute('title', hint ? (base + ' ' + hint) : base);
    });

    scope.querySelectorAll('.lbl, input[id], select[id], textarea[id], button[id]').forEach((el) => {
      const tag = String(el.tagName || '').toLowerCase();
      const type = String(el.getAttribute('type') || '').toLowerCase();
      if (tag === 'input' && type === 'hidden') return;
      if ((tag === 'input' && (type === 'checkbox' || type === 'radio')) && !el.id) return;
      if (el.closest('thead')) return;
      if (el.classList?.contains('iconBtn') || el.classList?.contains('iconBtnSm')) return;
      if (el.hasAttribute('title')) return;

      const labelText = getControlHelpLabel(el);
      if (!labelText) return;
      const sectionTitle = getClosestHelpSectionTitle(el);
      const helpText = buildControlHelpText(el, labelText, sectionTitle);
      el.setAttribute('title', helpText);
    });
  } catch (e) { console.error('ensurePermCatalogLoaded:', e); }
}
const APP_BASE_PATH = (() => {
  const parts = String(location.pathname || "")
    .split("/")
    .filter(Boolean);
  const publicIndex = parts.findIndex((part) => part.toLowerCase() === "public");
  if (publicIndex > 0) {
    return `/${parts.slice(0, publicIndex).join("/")}`;
  }
  if (parts[0] && parts[0].toLowerCase() === "inventarioprincipal") {
    return `/${parts[0]}`;
  }
  return "";
})();
const API_ORIGIN = `${location.origin}${APP_BASE_PATH}`;
const SOCKET_ORIGIN = location.origin;
const SOCKET_PATH = `${APP_BASE_PATH}/socket.io`;

const RUNTIME_ORIGIN = API_ORIGIN;
const rewriteApiUrl = (rawUrl) => {
  const url = String(rawUrl || "");
  if (!url) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith(location.origin)) {
    return url;
  }
  if (url.startsWith("/api/")) return `${RUNTIME_ORIGIN}${url}`;
  if (url.startsWith("api/")) return `${RUNTIME_ORIGIN}/${url}`;
  const absPrefix = `${location.origin}/api/`;
  if (url.startsWith(absPrefix)) {
    const rel = url.slice(location.origin.length);
    return `${RUNTIME_ORIGIN}${rel}`;
  }
  return url;
};

if (typeof window.fetch === "function") {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === "string") {
      return nativeFetch(rewriteApiUrl(input), init);
    }
    if (typeof Request !== "undefined" && input instanceof Request) {
      const nextUrl = rewriteApiUrl(input.url || "");
      if (nextUrl !== input.url) {
        return nativeFetch(new Request(nextUrl, input), init);
      }
    }
    return nativeFetch(input, init);
  };
}

if (typeof XMLHttpRequest !== "undefined") {
  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    return nativeOpen.call(this, method, rewriteApiUrl(url), ...rest);
  };
}
const DEFAULT_INACTIVITY_LOGOUT_MS = 30 * 60 * 1000;

let inactivityLogoutTimer = null;
let inactivityLogoutMs = DEFAULT_INACTIVITY_LOGOUT_MS;
let inactivityEventsBound = false;
let entSaveInFlight = false;
let salSaveInFlight = false;
let ajSaveInFlight = false;
let pedSaveInFlight = false;
let pedNowTimer = null;
let pedDispatchBatchInFlight = false;
let pedDispatchRevertInFlight = false;
const pedDispatchLineInFlight = new Set();

function getDeviceKey() {
  try {
    const q = new URLSearchParams(window.location.search || "");
    const fromQuery = (q.get("device_key") || "").trim();
    if (fromQuery) {
      localStorage.setItem("device_key", fromQuery);
      return fromQuery;
    }
    return (localStorage.getItem("device_key") || "").trim();
  } catch {
    return "";
  }
}
function performLogout() {
  const deviceKey = (localStorage.getItem("device_key") || "").trim();
  localStorage.clear();
  if (deviceKey) localStorage.setItem("device_key", deviceKey);
  location.href = "/login";
}

function resetInactivityLogoutTimer() {
  if (inactivityLogoutTimer) clearTimeout(inactivityLogoutTimer);
  if (!Number.isFinite(inactivityLogoutMs) || inactivityLogoutMs <= 0) return;
  inactivityLogoutTimer = setTimeout(() => {
    performLogout();
  }, inactivityLogoutMs);
}

async function loadSessionPolicy() {
  try {
    const headers = { Authorization: "Bearer " + token };
    const deviceKey = getDeviceKey();
    if (deviceKey) headers["x-device-key"] = deviceKey;
    const r = await fetch("/api/session-policy", { headers });
    const j = await r.json().catch(() => ({}));
    if (r.ok && typeof j?.inactivity_logout_ms === "number") {
      inactivityLogoutMs = Number(j.inactivity_logout_ms);
    } else {
      inactivityLogoutMs = DEFAULT_INACTIVITY_LOGOUT_MS;
    }
  } catch {
    inactivityLogoutMs = DEFAULT_INACTIVITY_LOGOUT_MS;
  }
}

function initInactivityLogout() {
  if (inactivityEventsBound) return;
  const events = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"];
  events.forEach((ev) => {
    window.addEventListener(ev, resetInactivityLogoutTimer, { passive: true });
  });
  window.addEventListener("mousemove", resetInactivityLogoutTimer);
  inactivityEventsBound = true;
  loadSessionPolicy()
    .catch(() => {})
    .finally(() => resetInactivityLogoutTimer());
}

function initDatePickers(root = document) {
  if (!root || !root.querySelectorAll || !window.flatpickr) return;
  const localeEs = window.flatpickr?.l10ns?.es || "es";
  root.querySelectorAll('input[type="date"]').forEach((el) => {
    if (!el || el._flatpickr) return;
    const baseClass = (el.className || "in").trim();
    window.flatpickr(el, {
      locale: localeEs,
      dateFormat: "Y-m-d",
      altInput: true,
      altFormat: "d/m/Y",
      altInputClass: `${baseClass} flatpickr-alt-input`,
      allowInput: false,
      disableMobile: true,
      clickOpens: !el.disabled,
    });
  });
}

function setDateInputValue(el, value) {
  if (!el) return;
  if (el._flatpickr) {
    el._flatpickr.setDate(value, false, "Y-m-d");
  } else {
    el.value = value;
  }
}

function clearDateInputValue(el) {
  if (!el) return;
  if (el._flatpickr) {
    el._flatpickr.clear();
  } else {
    el.value = "";
  }
}

function isMobileAdaptiveView() {
  return window.innerWidth <= 980 || window.matchMedia?.("(max-width: 980px)")?.matches;
}

function closeMobileNav() {
  document.body?.classList.remove("menu-open");
}

function initMobileAdaptiveNav() {
  const body = document.body;
  const rail = document.querySelector(".rail");
  const menu = document.querySelector(".menu");
  if (!body || !rail || !menu) return;

  const applyMode = () => {
    const enabled = isMobileAdaptiveView();
    body.classList.toggle("mobile-nav", enabled);
    if (!enabled) body.classList.remove("menu-open");
  };

  applyMode();
  window.addEventListener("resize", applyMode);

  rail.addEventListener("click", (e) => {
    if (!body.classList.contains("mobile-nav")) return;
    e.preventDefault();
    body.classList.toggle("menu-open");
  });

  document.addEventListener("click", (e) => {
    if (!body.classList.contains("mobile-nav") || !body.classList.contains("menu-open")) return;
    const t = e.target;
    if (menu.contains(t) || rail.contains(t)) return;
    closeMobileNav();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMobileNav();
  });
}

let modalScrollLockActive = false;
let modalScrollY = 0;

function lockBodyScrollForModal() {
  if (modalScrollLockActive || !document.body) return;
  modalScrollLockActive = true;
  modalScrollY = window.scrollY || window.pageYOffset || 0;
  document.documentElement?.classList.add("modal-open");
  document.body.classList.add("modal-open");
  document.body.style.top = `-${modalScrollY}px`;
}

function unlockBodyScrollForModal() {
  if (!modalScrollLockActive || !document.body) return;
  modalScrollLockActive = false;
  document.documentElement?.classList.remove("modal-open");
  document.body.classList.remove("modal-open");
  document.body.style.top = "";
  window.scrollTo(0, modalScrollY);
}

function syncModalScrollLock() {
  const hasVisibleModal = Boolean(document.querySelector(".modal:not(.hidden)"));
  if (hasVisibleModal) lockBodyScrollForModal();
  else unlockBodyScrollForModal();
}

function initModalScrollLock() {
  if (!document.body) return;
  syncModalScrollLock();
  if (!window.MutationObserver) return;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        const target = mutation.target;
        if (target?.classList?.contains("modal")) {
          syncModalScrollLock();
          return;
        }
      }
      if (mutation.type === "childList") {
        const addedModal = Array.from(mutation.addedNodes || []).some(
          (n) => n?.nodeType === 1 && (n.matches?.(".modal") || n.querySelector?.(".modal"))
        );
        const removedModal = Array.from(mutation.removedNodes || []).some(
          (n) => n?.nodeType === 1 && (n.matches?.(".modal") || n.querySelector?.(".modal"))
        );
        if (addedModal || removedModal) {
          syncModalScrollLock();
          return;
        }
      }
    }
  });

  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class"],
  });
}

function setMenuAccordionExpanded(groupEl, expanded) {
  if (!groupEl) return;
  groupEl.classList.toggle("is-collapsed", !expanded);
  const toggle = groupEl.querySelector("[data-menu-group-toggle]");
  if (toggle) toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
}

function expandMenuGroupForSection(sectionKey) {
  const btn = document.querySelector(`.menuBtn[data-section="${sectionKey}"]`);
  const group = btn?.closest(".menuAccordion");
  if (!group) return;
  setMenuAccordionExpanded(group, true);
}

function initMenuAccordions() {
  const groups = Array.from(document.querySelectorAll(".menuAccordion"));
  if (!groups.length) return;
  groups.forEach((group) => {
    const toggle = group.querySelector("[data-menu-group-toggle]");
    if (!toggle) return;
    setMenuAccordionExpanded(group, !group.classList.contains("is-collapsed"));
    toggle.onclick = () => {
      const isCollapsed = group.classList.contains("is-collapsed");
      groups.forEach((g) => setMenuAccordionExpanded(g, false));
      setMenuAccordionExpanded(group, isCollapsed);
    };
  });
}

function detectComboFixPlatform() {
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const touchPoints = Number(navigator.maxTouchPoints || 0);

  const isiOS = /iPad|iPhone|iPod/i.test(ua) || (platform === "MacIntel" && touchPoints > 1);
  const isMac = /Mac/i.test(platform) || /Mac OS X/i.test(ua);
  const isWindows = /Win/i.test(platform) || /Windows/i.test(ua);
  const isWebKitSafari = /WebKit/i.test(ua) && !/CriOS|Chrome|Chromium|Edg|EdgiOS|FxiOS|OPiOS/i.test(ua);

  if ((isiOS || isMac) && isWebKitSafari) return "apple";
  if (isWindows) return "windows";
  return "";
}

function applyComboFixClass(comboClass, root = document) {
  if (!comboClass || !root || !root.querySelectorAll) return;
  root.querySelectorAll("select.in").forEach((el) => {
    el.classList.add(comboClass);
  });
}

function initComboFix() {
  const platformKind = detectComboFixPlatform();
  if (!platformKind) return;

  const bodyClass = platformKind === "apple" ? "apple-webkit" : "windows-webkit";
  const comboClass = platformKind === "apple" ? "combo-apple-fix" : "combo-win-fix";

  document.body?.classList.add(bodyClass);
  applyComboFixClass(comboClass, document);

  if (!window.MutationObserver || !document.body) return;
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (!node || node.nodeType !== 1) return;
        if (node.matches?.("select.in")) node.classList.add(comboClass);
        applyComboFixClass(comboClass, node);
      });
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

let menuWarehouseLabel = me?.warehouse_name
  ? String(me.warehouse_name)
  : me?.id_warehouse
  ? "Cargando bodega..."
  : "Sin bodega";
let menuAvatarData = typeof me?.avatar_url === "string" ? me.avatar_url.trim() : "";
const warehouseLogoCache = new Map();
const warehouseContactCache = new Map();

function userInitial(name) {
  const n = String(name || "").trim();
  if (!n) return "U";
  return n.charAt(0).toUpperCase();
}

function renderMenuUserLabel() {
  const el = $("#meName");
  if (!el) return;
  const userName = me?.full_name ? String(me.full_name).trim() : "Usuario";
  el.textContent = `${userName} - ${menuWarehouseLabel}`;
}

function renderMenuAvatar() {
  const img = $("#menuAvatarImg");
  if (!img) return;
  if (menuAvatarData && menuAvatarData.startsWith("data:image/")) {
    img.src = menuAvatarData;
    img.classList.remove("hidden");
  } else {
    img.removeAttribute("src");
    img.classList.add("hidden");
  }
}

async function fetchWarehouseLogoPayload(idWarehouse, { force = false } = {}) {
  const id = Number(idWarehouse || 0);
  if (!id) return { app: "", print: "", effective: "" };
  if (!force && warehouseLogoCache.has(id)) return warehouseLogoCache.get(id) || { app: "", print: "", effective: "" };
  try {
    const r = await fetch(`/api/bodegas/${id}/logo`, {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { app: "", print: "", effective: "" };
    const payload = {
      app: typeof j?.logo_app_data === "string" ? j.logo_app_data.trim() : "",
      print: typeof j?.logo_print_data === "string" ? j.logo_print_data.trim() : "",
      effective: typeof j?.effective_logo_data === "string" ? j.effective_logo_data.trim() : "",
    };
    warehouseLogoCache.set(id, payload);
    return payload;
  } catch {
    return { app: "", print: "", effective: "" };
  }
}

async function fetchWarehouseContact(idWarehouse, { force = false } = {}) {
  const id = Number(idWarehouse || 0);
  if (!id) return { phone: "", address: "" };
  if (!force && warehouseContactCache.has(id)) return warehouseContactCache.get(id) || { phone: "", address: "" };
  try {
    const r = await fetch(`/api/bodegas/${id}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { phone: "", address: "" };
    const payload = {
      phone: typeof j?.telefono_contacto === "string" ? j.telefono_contacto.trim() : "",
      address: typeof j?.direccion_contacto === "string" ? j.direccion_contacto.trim() : "",
    };
    warehouseContactCache.set(id, payload);
    return payload;
  } catch {
    return { phone: "", address: "" };
  }
}

async function fetchPreferredWarehouseContact(...warehouseIds) {
  const normalized = warehouseIds.map((x) => Number(x || 0)).filter((x) => x > 0);
  for (const id of normalized) {
    const payload = await fetchWarehouseContact(id);
    if (payload.phone || payload.address) return payload;
  }
  return { phone: "", address: "" };
}

async function fetchWarehouseLogoData(idWarehouse, variant = "app", opts = {}) {
  const payload = await fetchWarehouseLogoPayload(idWarehouse, opts);
  if (variant === "print") return payload.print || payload.effective || "";
  return payload.app || "";
}

async function fetchPreferredWarehousePrintLogoData(...warehouseIds) {
  const normalized = warehouseIds.map((x) => Number(x || 0)).filter((x) => x > 0);
  for (const id of normalized) {
    const payload = await fetchWarehouseLogoPayload(id);
    if (payload.print) return payload.print;
  }
  if (!normalized.length) return "";
  const payload = await fetchWarehouseLogoPayload(normalized[0]);
  return payload.effective || "";
}

async function applyWarehouseBranding(idWarehouse = me?.id_warehouse) {
  const logoData = await fetchWarehouseLogoData(idWarehouse);
  const railImg = $("#railLogoImg");
  const stageImg = $("#stageHeadLogoImg");
  const fallbackSrc = "/imagenes/Oficial_JDL_blanco.png";
  if (railImg) railImg.src = logoData || fallbackSrc;
  if (stageImg) stageImg.src = logoData || fallbackSrc;
}

renderMenuUserLabel();
renderMenuAvatar();
applyWarehouseBranding().catch(() => {});
initComboFix();
initDatePickers(document);
ensureNativeUiClasses();
normalizeAddViewsLayout();
applyAddViewButtonLabels();
applyAddFieldHints();
ensureStaticSelectCatalogs();
safeRebuildAddViewSections();
applyUiHelpTooltips(document);
initMobileAdaptiveNav();
initModalScrollLock();
initMenuAccordions();
initInactivityLogout();
startPedidoNowTicker();

initPermissionsUI();
setTimeout(() => {
  initHomeDashboard().catch(() => {});
}, 0);

let pedidosSocket = null;
let pedidosRealtimeTimer = null;

function schedulePedidosRealtimeRefresh() {
  if (pedidosRealtimeTimer) clearTimeout(pedidosRealtimeTimer);
  pedidosRealtimeTimer = setTimeout(() => {
    if (currentSection === "pedidos-despachar") {
      loadPedidosDespachar();
    }
    if (currentSection === "r-pedidos") {
      loadReportePedidos();
    }

  }, 250);
}
async function initPedidosRealtime() {
  if (!token || pedidosSocket) return;

  if (!window.io) {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `${SOCKET_ORIGIN}${SOCKET_PATH}/socket.io.js`;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error("No se pudo cargar socket.io"));
      document.head.appendChild(s);
    });
  }

  if (!window.io) return;

  pedidosSocket = window.io(SOCKET_ORIGIN, {
    auth: { token },
    path: SOCKET_PATH,
    transports: ["websocket", "polling"],
    reconnection: true,
  });

  pedidosSocket.on("pedido:changed", () => {
    schedulePedidosRealtimeRefresh();
  });
}

initPedidosRealtime().catch(() => {});

const titles = {
  home: "Inicio",
  entradas: "Entradas",
  salidas: "Salidas",
  ajustes: "Ajustes",
  pedidos: "Realizar pedidos",
  "pedidos-despachar": "Pedidos x Despachar",
  "cuadre-caja": "Cuadre de caja",
  categorias: "Categorias",
  subcategorias: "Subcategorias",
  "motivos-movimiento": "Motivo movimiento",
  proveedores: "Proveedores",
  productos: "Productos",
  limites: "Minimos y maximos",
  "reglas-subcategorias": "Reglas por subcategoria",
  usuarios: "Usuarios",
  bodegas: "Bodegas",
  "r-entradas": "Reporte de Entradas",
  "r-salidas": "Reporte de Salidas",
  "r-pedidos": "Reporte de Pedidos",
  "r-tendencia-producto": "Reporte Tendencia de Producto",
  "r-transferencias": "Reporte Kardex",
  "r-existencias": "Reporte de Existencias",
  "r-corte-diario": "Reporte Corte Diario",
  "r-cuadres-caja": "Reporte Cuadres de Caja",
  "r-auditoria-sensibles": "Auditoria de Acciones Sensibles",
};

let currentSection = "home";
let myPerms = {};
let permCatalog = [];
let myIsAdminRole = false;
var permGuardBound = false;
let usrPermUsersLoaded = false;
let currentPermUserId = 0;
let usrWhAccessUsersLoaded = false;
let currentWhAccessUserId = 0;
var userAccordionsBound = false;

const sectionPermMap = {
  home: "section.view.home",
  entradas: "section.view.entradas",
  salidas: "section.view.salidas",
  ajustes: "section.view.ajustes",
  pedidos: "section.view.pedidos",
  "pedidos-despachar": "section.view.pedidos-despachar",
  "cuadre-caja": "section.view.cuadre-caja",
  categorias: "section.view.categorias",
  subcategorias: "section.view.subcategorias",
  "motivos-movimiento": "section.view.motivos-movimiento",
  proveedores: "section.view.proveedores",
  productos: "section.view.productos",
  limites: "section.view.limites",
  "reglas-subcategorias": "section.view.reglas-subcategorias",
  usuarios: "section.view.usuarios",
  bodegas: "section.view.bodegas",
  "r-existencias": "section.view.r-existencias",
  "r-corte-diario": "section.view.r-corte-diario",
  "r-cuadres-caja": "section.view.cuadre-caja",
  "r-entradas": "section.view.r-entradas",
  "r-salidas": "section.view.r-salidas",
  "r-pedidos": "section.view.r-pedidos",
  "r-tendencia-producto": "section.view.r-pedidos",
  "r-transferencias": "section.view.r-transferencias",
  "r-auditoria-sensibles": "section.view.r-auditoria-sensibles",
};

function enforceCurrentSectionAccess() {
  const secPerm = sectionPermMap[currentSection];
  if (hasPerm(secPerm)) return;
  const fallbackBtn = Array.from(document.querySelectorAll(".menuBtn[data-section]")).find(
    (btn) => btn.style.display !== "none"
  );
  if (fallbackBtn) {
    fallbackBtn.click();
    return;
  }
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  if ($("#stageTitle")) $("#stageTitle").textContent = "Sin acceso";
}

function hasPerm(key) {
  if (!key) return true;
  if (!myPerms || typeof myPerms !== "object") return true;
  if (!(key in myPerms)) return true;
  return Number(myPerms[key]) === 1;
}

function syncUserAccordionState(section, expanded) {
  if (!section) return;
  section.classList.toggle("is-collapsed", !expanded);
  const toggle = section.querySelector("[data-user-acc-toggle]");
  if (toggle) toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
}

function initUserAccordions() {
  const view = $("#view-usuarios");
  if (!view) return;

  const sections = Array.from(view.querySelectorAll(".userSection"));
  sections.forEach((section) => {
    const expanded = !section.classList.contains("is-collapsed");
    syncUserAccordionState(section, expanded);
    const toggle = section.querySelector("[data-user-acc-toggle]");
    if (toggle) {
      toggle.onclick = () => {
        const nextExpanded = section.classList.contains("is-collapsed");
        syncUserAccordionState(section, nextExpanded);
      };
    }
  });

  if (userAccordionsBound) return;
  view.addEventListener("click", (e) => {
    const toggle = e.target?.closest ? e.target.closest("[data-user-acc-toggle]") : null;
    if (!toggle) return;
    const section = toggle.closest(".userSection");
    if (!section) return;
    const expanded = section.classList.contains("is-collapsed");
    syncUserAccordionState(section, expanded);
  });
  userAccordionsBound = true;
}
async function loadMyPermissions() {
  try {
    const r = await fetch("/api/me/permisos", {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return;
    myPerms = j.permisos || {};
    permCatalog = Array.isArray(j.catalogo) ? j.catalogo : [];
    myIsAdminRole = Number(j?.is_admin_role || 0) === 1 || j?.is_admin_role === true;
  } catch (e) { console.error('api_usuarios:', e); }
}

function applyMenuPermissions() {
  document.querySelectorAll(".menuBtn[data-section]").forEach((b) => {
    const sec = b.dataset.section || "";
    const p = sectionPermMap[sec];
    b.style.display = hasPerm(p) ? "" : "none";
  });
  document.querySelectorAll(".menuAccordion").forEach((group) => {
    const hasVisibleButtons = Array.from(group.querySelectorAll(".menuBtn[data-section]")).some(
      (btn) => btn.style.display !== "none"
    );
    group.style.display = hasVisibleButtons ? "" : "none";
  });
}

function applyActionPermissions() {
  const exportIds = ["#repExistExport", "#repEntExport", "#repSalExport", "#repPedExport", "#repKarExport", "#repCloseExport"];
  exportIds.forEach((id) => {
    const el = $(id);
    if (el) el.disabled = !hasPerm("action.export_excel");
  });

  const createEditIds = [
    "#catSave", "#catEditSave", "#subCatSave", "#subCatEditSave", "#motSave",
    "#provSave", "#provEditSave", "#bodSave", "#bodEditSave", "#bodLogoSave", "#bodLogoAppFile", "#bodLogoAppClear", "#bodLogoPrintFile", "#bodLogoPrintClear", "#prdSave", "#prdEditSave",
    "#prdImportBtn", "#prdImportFile", "#prdImportDelimiter",
    "#prdStockImportBtn", "#prdStockImportFile", "#prdStockImportDelimiter", "#prdStockImportMotivo", "#prdStockImportObs",
    "#catImportBtn", "#catImportFile", "#catImportDelimiter",
    "#subCatImportBtn", "#subCatImportFile", "#subCatImportDelimiter",
    "#provImportBtn", "#provImportFile", "#provImportDelimiter",
    "#limImportBtn", "#limImportFile", "#limImportDelimiter",
    "#limSave", "#limEditSave", "#regSave", "#regEditSave", "#usrSave", "#usrEditSave",
    "#usrResetSave", "#usrOrderPin", "#usrCanSupervisor", "#usrNoAutoLogout", "#usrEditNoAutoLogout", "#usrEditCanSupervisor",
    "#usrResetOrderPin", "#usrResetOrderPin2", "#usrResetOrderPinSave",
    "#ajDireccion", "#ajMotivo", "#ajObservacion", "#ajWarehouse", "#ajProducto", "#ajLote", "#ajCaducidad", "#ajCosto", "#ajCantidad", "#ajObsLinea", "#ajAdd", "#ajClear", "#ajSave",
    "#cuadreSave", "#cuadreAddDetailRow",
  ];
  createEditIds.forEach((id) => {
    const el = $(id);
    if (el) el.disabled = !hasPerm("action.create_update");
  });

  const filterSelectors = [
    "#repExistSearch", "#repEntSearch", "#repSalSearch", "#repPedSearch", "#repKarSearch",
    "#repDiaSearch", "#repDiaClear", "#repDiaQuery", "#repDiaShowAll", "#repDiaWarehouse", "#repDiaPdf",
    "#repCuadreSearch", "#repCuadreClear", "#repCuadreFecha", "#repCuadreWarehouse", "#repCuadreResponsable",
    "#cuadreSearch", "#cuadreClear", "#cuadreFecha", "#cuadreWarehouse", "#cuadrePrintPos", "#cuadrePrintCarta", "#cuadrePdfFormat", "#cuadreSavePdf",
    "#repCloseWarehouse", "#repCloseSearchDate", "#repCloseSearchBtn", "#repCloseAllBtn",
    "#repExistQuery", "#repEntQuery", "#repSalQuery", "#repPedQuery", "#repKarQuery",
    "#repEntLote", "#repSalLote", "#repPedLote", "#repKarLote",
    "#repDateFrom", "#repDateTo", "#repEntDateFrom", "#repEntDateTo", "#repSalDateFrom", "#repSalDateTo",
    "#repPedDateFrom", "#repPedDateTo", "#repKarDateFrom", "#repKarDateTo",
    "#repExistWarehouse", "#repEntWarehouse", "#repSalWarehouse", "#repPedWarehouseReq", "#repPedWarehouseDesp", "#repKarWarehouse",
    "#repAudDateFrom", "#repAudDateTo", "#repAudAction", "#repAudQuery", "#repAudSearch", "#repAudClear",
  ];
  filterSelectors.forEach((id) => {
    const el = $(id);
    if (el) el.disabled = !hasPerm("action.filter");
  });

  if ($("#usrPermSave")) $("#usrPermSave").disabled = !hasPerm("action.manage_permissions");
  if ($("#usrPermReload")) $("#usrPermReload").disabled = !hasPerm("action.manage_permissions");
  if ($("#usrPermUser")) $("#usrPermUser").disabled = !hasPerm("action.manage_permissions");
  if ($("#usrWhAccessSave")) $("#usrWhAccessSave").disabled = !hasPerm("action.manage_permissions");
  if ($("#usrWhAccessReload")) $("#usrWhAccessReload").disabled = !hasPerm("action.manage_permissions");
  if ($("#usrWhAccessUser")) $("#usrWhAccessUser").disabled = !hasPerm("action.manage_permissions");
  if ($("#usrPermList")) $("#usrPermList").style.opacity = hasPerm("action.manage_permissions") ? "1" : ".55";
  if ($("#usrWhAccessList")) $("#usrWhAccessList").style.opacity = hasPerm("action.manage_permissions") ? "1" : ".7";
  document.querySelectorAll("#usrPermList .permSwitch").forEach((sw) => {
    sw.disabled = !hasPerm("action.manage_permissions");
  });
  document.querySelectorAll("#usrWhAccessList .warehouseCheck").forEach((sw) => {
    sw.disabled = !hasPerm("action.manage_permissions") || sw.disabled;
  });
}

function bindPermissionGuards() {
  if (permGuardBound) return;
  document.addEventListener(
    "click",
    (e) => {
      const t = e.target;
      const btn = t?.closest ? t.closest("button, .iconBtn, .dispatchBtn") : null;
      if (!btn) return;

      if (!hasPerm("action.export_excel") && btn.id && btn.id.startsWith("rep") && btn.id.endsWith("Export")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        showEntToast("No tienes permiso para exportar.", "bad");
        return;
      }
      if (!hasPerm("action.delete") && btn.classList?.contains("del")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        showEntToast("No tienes permiso para eliminar/desactivar.", "bad");
        return;
      }
      if (!hasPerm("action.create_update") && btn.classList?.contains("edit")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        showEntToast("No tienes permiso para editar.", "bad");
        return;
      }
      if (
        !hasPerm("action.dispatch") &&
        (btn.matches?.("[data-fulfill], [data-fulfill-one], [data-revert], [data-revert-one]") ||
          btn.id === "pedDispatchConfirm")
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        showEntToast("No tienes permiso para despachar/revertir.", "bad");
      }
    },
    true
  );
  permGuardBound = true;
}

async function initPermissionsUI() {
  await loadMyPermissions();
  applyMenuPermissions();
  applyActionPermissions();
  bindPermissionGuards();
  setTimeout(() => enforceCurrentSectionAccess(), 0);
}

let homeDashKind = "vigentes";
let homeDashBound = false;
const homeDashDays = 30;
const homeDashMovDays = 30;
const homeDashFetchTimeoutMs = 15000;

async function fetchWithTimeout(url, options = {}, timeoutMs = homeDashFetchTimeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function fmtQtyDashboard(v) {
  return Number(v || 0).toLocaleString("en-US", { maximumFractionDigits: 3 });
}

function fmtCurrencyDashboard(v) {
  return Number(v || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "GTQ",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function homeDashTitle(kind) {
  const m = {
    vigentes: "Detalle: productos vigentes",
    vencidos: "Detalle: productos vencidos",
    proximos: "Detalle: productos proximos a vencer",
    rotar: "Detalle: productos por rotar",
    mas_mov: "Detalle: productos con mayor movimiento",
    menos_mov: "Detalle: productos con menor movimiento",
    stock_minimo: "Detalle: control de stock minimo",
  };
  return m[kind] || "Detalle";
}

function setHomeDashActive(kind) {
  document.querySelectorAll("#homeDashCards .homeDashCard[data-kind]").forEach((x) => {
    x.classList.toggle("active", x.dataset.kind === kind);
  });
}

function renderHomeDashTable(kind, rows) {
  const head = $("#homeDashHead");
  const body = $("#homeDashBody");
  const meta = $("#homeDashDetailMeta");
  if (!head || !body) return;
  $("#homeDashDetailTitle").textContent = homeDashTitle(kind);
  if (!Array.isArray(rows) || !rows.length) {
    head.innerHTML = `<th>Resultado</th>`;
    body.innerHTML = `<tr><td>Sin datos para este indicador.</td></tr>`;
    if (meta) meta.textContent = "0 registros";
    return;
  }

  if (kind === "stock_minimo") {
    head.innerHTML = `
      <th>Bodega</th>
      <th>Producto</th>
      <th>SKU</th>
      <th>Stock</th>
      <th>Minimo</th>
      <th>Maximo</th>
      <th>Estado</th>
    `;
    body.innerHTML = rows
      .map(
        (x) => `
        <tr>
          <td>${x.nombre_bodega || ""}</td>
          <td>${x.nombre_producto || ""}</td>
          <td>${x.sku || ""}</td>
          <td>${fmtQtyDashboard(x.stock)}</td>
          <td>${fmtQtyDashboard(x.minimo_stock)}</td>
          <td>${fmtQtyDashboard(x.maximo_stock)}</td>
          <td>${stockNivelBadge(x.stock, x.minimo_stock, x.maximo_stock) || (x.nivel_stock || "")}</td>
        </tr>
      `
      )
      .join("");
  } else if (kind === "mas_mov" || kind === "menos_mov") {
    head.innerHTML = `
      <th>Producto</th>
      <th>SKU</th>
      <th>Cantidad movimiento</th>
      <th>Stock actual</th>
      <th>Ultimo movimiento</th>
    `;
    body.innerHTML = rows
      .map(
        (x) => `
        <tr>
          <td>${x.nombre_producto || ""}</td>
          <td>${x.sku || ""}</td>
          <td>${fmtQtyDashboard(x.cantidad_movimiento)}</td>
          <td>${fmtQtyDashboard(x.stock_actual)}</td>
          <td>${fmtDateTime(x.ultimo_movimiento)}</td>
        </tr>
      `
      )
      .join("");
  } else {
    head.innerHTML = `
      <th>Bodega</th>
      <th>Producto</th>
      <th>SKU</th>
      <th>Lote</th>
      <th>Caducidad</th>
      <th>Dias para vencer</th>
      <th>Stock</th>
      <th>Costo unitario</th>
      <th>Total</th>
    `;
    body.innerHTML = rows
      .map(
        (x) => `
        <tr>
          <td>${x.nombre_bodega || ""}</td>
          <td>${x.nombre_producto || ""}</td>
          <td>${x.sku || ""}</td>
          <td>${x.lote || ""}</td>
          <td>${fmtDateOnly(x.fecha_vencimiento)}</td>
          <td>${x.dias_para_vencer ?? ""}</td>
          <td>${fmtQtyDashboard(x.stock)}</td>
          <td>${fmtMoney(x.costo_unitario)}</td>
          <td>${fmtMoney(x.total_linea)}</td>
        </tr>
      `
      )
      .join("");
  }

  if (meta) meta.textContent = `${rows.length} registros`;
}

async function loadHomeDashSummary(force = false) {
  if (!$("#homeDashCards")) return;
  try {
    const qs = new URLSearchParams({
      days: String(homeDashDays),
      mov_days: String(homeDashMovDays),
    });
    if (force) qs.set("force", "1");
    const r = await fetchWithTimeout(`/api/dashboard/resumen?${qs.toString()}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      showEntToast(j.error || "No se pudo cargar el panel principal.", "bad");
      if ($("#homeDashScope")) $("#homeDashScope").textContent = "No se pudo cargar el resumen.";
      return;
    }
    const s = j.resumen || {};
    if ($("#homeCardVigentes")) $("#homeCardVigentes").textContent = fmtQtyDashboard(s.productos_vigentes);
    if ($("#homeCardVigentesQty")) $("#homeCardVigentesQty").textContent = `Cantidad: ${fmtQtyDashboard(s.cantidad_vigente)}`;
    if ($("#homeCardVencidos")) $("#homeCardVencidos").textContent = fmtQtyDashboard(s.productos_vencidos);
    if ($("#homeCardVencidosQty")) $("#homeCardVencidosQty").textContent = `Cantidad: ${fmtQtyDashboard(s.cantidad_vencida)}`;
    if ($("#homeCardProximos")) $("#homeCardProximos").textContent = fmtQtyDashboard(s.productos_proximos);
    if ($("#homeCardProximosQty")) $("#homeCardProximosQty").textContent = `Cantidad: ${fmtQtyDashboard(s.cantidad_proxima)}`;
    if ($("#homeCardRotar")) $("#homeCardRotar").textContent = fmtQtyDashboard(s.productos_proximos);
    if ($("#homeCardBajoMinimo")) $("#homeCardBajoMinimo").textContent = fmtQtyDashboard(s.productos_bajo_minimo);
    if ($("#homeCardEntreMinimoIdeal")) $("#homeCardEntreMinimoIdeal").textContent = `Proximo a minimo: ${fmtQtyDashboard(s.productos_proximo_minimo ?? s.productos_entre_minimo_ideal)}`;
    if ($("#homeCardDinero")) $("#homeCardDinero").textContent = fmtCurrencyDashboard(s.total_dinero);
    if ($("#homeCardMasMov")) $("#homeCardMasMov").textContent = j.mas_movimiento?.nombre_producto || "Sin movimientos";
    if ($("#homeCardMasMovQty")) $("#homeCardMasMovQty").textContent = `Cantidad: ${fmtQtyDashboard(j.mas_movimiento?.cantidad_movimiento || 0)}`;
    if ($("#homeCardMenosMov")) $("#homeCardMenosMov").textContent = j.menos_movimiento?.nombre_producto || "Sin movimientos";
    if ($("#homeCardMenosMovQty")) $("#homeCardMenosMovQty").textContent = `Cantidad: ${fmtQtyDashboard(j.menos_movimiento?.cantidad_movimiento || 0)}`;

    const scopeText = (() => {
      const scope = j.scope || {};
      if (scope.id_bodega && scope.bodega_nombre) return `Datos de bodega: ${scope.bodega_nombre}`;
      if (scope.can_all_bodegas) return "Datos consolidados de todas las bodegas";
      return "Datos de la bodega del usuario";
    })();
    if ($("#homeDashScope")) $("#homeDashScope").textContent = scopeText;
    if (j?.cache?.warming) {
      setTimeout(() => {
        loadHomeDashSummary(false).catch(() => {});
      }, 1800);
    }
  } catch (e) {
    if (e?.name === "AbortError") {
      showEntToast("El resumen tardo demasiado. Intenta actualizar panel.", "bad");
      if ($("#homeDashScope")) $("#homeDashScope").textContent = "El resumen tardo demasiado.";
    } else {
      showEntToast("Error de red cargando panel principal.", "bad");
      if ($("#homeDashScope")) $("#homeDashScope").textContent = "Error de red cargando resumen.";
    }
  }
}

async function loadHomeDashDetail(kind = homeDashKind) {
  if (!$("#homeDashBody")) return;
  homeDashKind = kind;
  setHomeDashActive(kind);
  const body = $("#homeDashBody");
  const head = $("#homeDashHead");
  if (head) head.innerHTML = `<th>Cargando...</th>`;
  if (body) body.innerHTML = `<tr><td>Cargando detalle...</td></tr>`;
  try {
    const qs = new URLSearchParams({
      kind,
      days: String(homeDashDays),
      mov_days: String(homeDashMovDays),
      limit: "300",
    });
    const r = await fetchWithTimeout(`/api/dashboard/detalle?${qs.toString()}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      showEntToast(j.error || "No se pudo cargar el detalle del panel.", "bad");
      renderHomeDashTable(kind, []);
      return;
    }
    renderHomeDashTable(kind, j.rows || []);
  } catch (e) {
    if (e?.name === "AbortError") {
      showEntToast("El detalle tardo demasiado. Intenta de nuevo.", "bad");
    } else {
      showEntToast("Error de red cargando detalle del panel.", "bad");
    }
    renderHomeDashTable(kind, []);
  }
}

function bindHomeDashEvents() {
  if (homeDashBound) return;
  document.querySelectorAll("#homeDashCards .homeDashCard[data-kind]").forEach((x) => {
    x.onclick = () => loadHomeDashDetail(x.dataset.kind || "vigentes");
  });
  if ($("#homeDashRefresh")) {
    $("#homeDashRefresh").onclick = async () => {
      await Promise.allSettled([loadHomeDashSummary(true), loadHomeDashDetail(homeDashKind)]);
    };
  }
  homeDashBound = true;
}

async function initHomeDashboard() {
  if (!$("#view-home")) return;
  document.body.classList.add("hide-stage-header");
  document.body.classList.remove("section-pedidos");
  bindHomeDashEvents();
  await Promise.allSettled([loadHomeDashSummary(), loadHomeDashDetail(homeDashKind)]);
}

document.querySelectorAll(".menuBtn[data-section]").forEach((b) => {
  b.onclick = async () => {
    const key = b.dataset.section;
    const secPerm = sectionPermMap[key];
    if (!hasPerm(secPerm)) {
      showEntToast("No tienes acceso a este modulo.", "bad");
      return;
    }
    if (currentSection === "entradas" && entList.length && key !== "entradas") {
      showEntToast("Tienes productos en la lista. Guarda o vacia la lista antes de salir.", "bad");
      return;
    }
    if (currentSection === "salidas" && salList.length && key !== "salidas") {
      showEntToast("Tienes productos en la lista de salida. Guarda o vacia la lista antes de salir.", "bad");
      return;
    }
    if (currentSection === "pedidos" && pedList.length && key !== "pedidos") {
      if (!(await uiConfirm("Tienes productos en el carro. Salir sin guardar el pedido?", "Salir sin guardar"))) return;
    }
    if ($("#stageTitle")) $("#stageTitle").textContent = titles[key] || "Seccion";
    document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
    const view = $("#view-" + key);
    if (view) {
      view.classList.remove("hidden");
      view.classList.add("animate");
      setTimeout(() => view.classList.remove("animate"), 400);
    }
    currentSection = key;
    if (currentSection === "pedidos" || currentSection === "home") {
      document.body.classList.add("hide-stage-header");
      if (currentSection === "pedidos") document.body.classList.add("section-pedidos");
      else document.body.classList.remove("section-pedidos");
    } else {
      document.body.classList.remove("hide-stage-header");
      document.body.classList.remove("section-pedidos");
    }
    expandMenuGroupForSection(currentSection);
    if (currentSection === "entradas") {
      setFechaHoraActual();
    }
    if (currentSection === "salidas") {
      setFechaHoraActual();
      motivosSalidaLoaded = false;
      loadBodegasSalida();
      loadMotivosSalida();
      loadBodegaUsuarioSalida();
      loadCorrelativoSalidaDocumento();
      loadSalidaConteoWarehouseFilter();
      loadSalidaConteoFinal();
      renderSalidas();
    }
    if (currentSection === "ajustes") {
      setFechaHoraActual();
      loadAjustesMotivos();
      loadAjustesWarehouseFilter();
      renderAjustes();
      $("#ajDireccion")?.dispatchEvent(new Event("change"));
    }
    if (currentSection === "pedidos") {
      setFechaHoraActual();
      loadBodegasPedido();
      loadUsuariosPedido();
      resetPedidoTab();
    }
    if (currentSection === "pedidos-despachar") {
      loadPedidosDespachar();
    }
    if (currentSection === "cuadre-caja") {
      loadCuadreWarehouseFilter();
      loadCuadreCaja();
    }
    if (currentSection === "r-existencias") {
      initReporteExistenciasCollapsibles();
      loadExistenciasBodegasFilter();
      loadReporteExistencias();
    }
    if (currentSection === "r-corte-diario") {
      loadReporteCorteWarehouseFilter();
      loadReporteCorteDiario();
    }
    if (currentSection === "r-cuadres-caja") {
      loadReporteCuadreWarehouseFilter().then(() => loadReporteCuadresCaja());
    }
    if (currentSection === "r-entradas") {
      repEntCatalogosLoaded = false;
      loadReporteEntradasCatalogos().then(() => loadReporteEntradas());
    }
    if (currentSection === "r-salidas") {
      repSalCatalogosLoaded = false;
      loadReporteSalidasCatalogos().then(() => loadReporteSalidas());
    }
    if (currentSection === "r-pedidos") {
      repPedCatalogosLoaded = false;
      loadReportePedidosCatalogos().then(() => loadReportePedidos());
    }
    if (currentSection === "r-tendencia-producto") {
      repTrendWarehouseLoaded = false;
      loadReporteTendenciaWarehouseFilter(true).then(() => loadReporteTendenciaProducto());
    }
    if (currentSection === "r-transferencias") {
      repKarCatalogosLoaded = false;
      loadReporteKardexCatalogos().then(() => loadReporteKardex());
    }
    if (currentSection === "r-auditoria-sensibles") {
      loadReporteAuditoriaSensibles();
    }
    if (currentSection === "bodegas") {
      safeRebuildAddViewSections();
      initBodegasCollapsibles();
      ensureStaticSelectCatalogs();
      loadBodegasManage();
    }
    if (currentSection === "categorias") {
      safeRebuildAddViewSections();
      loadCategoriasManage();
    }
    if (currentSection === "subcategorias") {
      safeRebuildAddViewSections();
      subcatCatalogosLoaded = false;
      loadSubcatCatalogos();
      loadSubcategoriasManage();
    }
    if (currentSection === "motivos-movimiento") {
      safeRebuildAddViewSections();
      loadMotivosManage();
    }
    if (currentSection === "proveedores") {
      safeRebuildAddViewSections();
      loadProveedoresManage();
    }
    if (currentSection === "productos") {
      safeRebuildAddViewSections();
      initProductosCollapsibles();
      prdCatalogosLoaded = false;
      loadCatalogosProductos();
      loadProductoWarehouseOptions();
      loadMotivosEntrada();
      loadProductosManage();
    }
    if (currentSection === "limites") {
      safeRebuildAddViewSections();
      limCatalogosLoaded = false;
      loadLimCatalogos();
      loadLimitesList();
    }
    if (currentSection === "reglas-subcategorias") {
      safeRebuildAddViewSections();
      regCatalogosLoaded = false;
      loadRegCatalogos();
      loadReglasList();
    }
    if (currentSection === "usuarios") {
      safeRebuildAddViewSections();
      initUserAccordions();
      usrRolesLoaded = false;
      usrBodegasLoaded = false;
      usrResetUsersLoaded = false;
      usrPermUsersLoaded = false;
      usrWhAccessUsersLoaded = false;
      loadRolesUsuario();
      loadBodegasUsuarioForm();
      loadUsuariosResetForm();
      loadUsuariosPermForm();
      loadUsuariosWarehouseAccessForm();
      loadUsuariosManage();
    }
    closeMobileNav();
  };
});

if ($("#logout")) {
  $("#logout").onclick = () => {
    performLogout();
  };
}

function money(n) {
  const x = Number(n || 0);
  return x.toFixed(2);
}

function updateEntradaTotal() {
  const qty = Number($("#entCantidad")?.value || 0);
  const price = Number($("#entPrecio")?.value || 0);
  if ($("#entTotal")) $("#entTotal").value = money(qty * price);
}

function setEntradaPrecioSugerido(precio) {
  const chip = $("#entPrecioSugeridoChip");
  if (!chip) return;
  const n = Number(precio || 0);
  if (n > 0) {
    chip.textContent = `Ultima entrada: ${money(n)}`;
    chip.dataset.price = String(n);
    chip.style.display = "inline-flex";
    return;
  }
  chip.textContent = "";
  chip.dataset.price = "";
  chip.style.display = "none";
}

if ($("#entCantidad")) $("#entCantidad").addEventListener("input", updateEntradaTotal);
if ($("#entPrecio")) $("#entPrecio").addEventListener("input", updateEntradaTotal);
if ($("#entPrecioSugeridoChip")) {
  $("#entPrecioSugeridoChip").addEventListener("click", () => {
    const suggested = Number($("#entPrecioSugeridoChip")?.dataset.price || 0);
    if (!suggested || suggested <= 0 || !$("#entPrecio")) return;
    $("#entPrecio").value = String(suggested);
    updateEntradaTotal();
  });
}

function clearSectionTextboxes(sectionSelector) {
  const root = $(sectionSelector);
  if (!root) return;
  root
    .querySelectorAll(
      "input[type='text'],input[type='number'],input[type='date'],input[type='time'],input[type='search'],input:not([type]),textarea"
    )
    .forEach((el) => {
      el.value = "";
    });
}

function clearSectionTextboxesExcept(sectionSelector, excludeSelectors = []) {
  const root = $(sectionSelector);
  if (!root) return;
  const excludes = Array.isArray(excludeSelectors) ? excludeSelectors.filter(Boolean) : [];
  root
    .querySelectorAll(
      "input[type='text'],input[type='number'],input[type='date'],input[type='time'],input[type='search'],input:not([type]),textarea"
    )
    .forEach((el) => {
      if (excludes.some((sel) => el.matches?.(sel))) return;
      el.value = "";
    });
}

function showEntToast(text, type = "bad", opts = {}) {
  const durationMs = Math.max(600, Number(opts?.durationMs || 4000));
  const legacyToast = $("#entToast");
  if (legacyToast) {
    legacyToast.className = `toast ${type}`;
    legacyToast.textContent = String(text || "");
    legacyToast.classList.remove("show");
    requestAnimationFrame(() => legacyToast.classList.add("show"));
    clearTimeout(legacyToast._timer);
    legacyToast._timer = setTimeout(() => legacyToast.classList.remove("show"), durationMs);
  }

  const bar = $("#alertBar");
  if (bar) {
    bar.className = `alertBar ${type}`;
    bar.innerHTML = `
      <div class="alertText">${text}</div>
      <button class="alertClose" type="button">?</button>
    `;
    bar.classList.remove("hidden");
    requestAnimationFrame(() => bar.classList.add("show"));
    const closeBtn = bar.querySelector(".alertClose");
    const close = () => {
      bar.classList.remove("show");
      setTimeout(() => bar.classList.add("hidden"), 200);
    };
    if (closeBtn) closeBtn.onclick = close;
    clearTimeout(bar._timer);
    bar._timer = setTimeout(close, durationMs);
    return;
  }
  const stack = $("#toastStack");
  if (!stack) return;
  const div = document.createElement("div");
  div.className = `toastFloat ${type}`;
  div.innerHTML = `
    <div class="toastIcon">${type === "ok" ? "OK" : "!"}</div>
    <div class="toastText">${text}</div>
  `;
  stack.appendChild(div);
  requestAnimationFrame(() => div.classList.add("show"));
  setTimeout(() => {
    div.classList.remove("show");
    setTimeout(() => div.remove(), 250);
  }, durationMs);
}

function showSavingProgressToast(label = "datos") {
  showEntToast(`Procesando ${String(label || "datos")}...`, "ok", { durationMs: 12000 });
}

let confirmResolve = null;
function closeConfirmModal(result) {
  const modal = $("#confirmModal");
  if (modal) modal.classList.add("hidden");
  if (confirmResolve) {
    const done = confirmResolve;
    confirmResolve = null;
    done(Boolean(result));
  }
}

function uiConfirm(message, title = "Confirmar accion") {
  const modal = $("#confirmModal");
  const text = $("#confirmText");
  const titleEl = $("#confirmTitle");
  if (!modal || !text || !titleEl) {
    showEntToast("No se pudo abrir la confirmacion personalizada.", "bad");
    return Promise.resolve(false);
  }
  titleEl.textContent = title;
  text.textContent = String(message || "Estas seguro?");
  modal.classList.remove("hidden");
  return new Promise((resolve) => {
    confirmResolve = resolve;
  });
}

let itemSearchResolve = null;
let itemSearchSelect = null;
let itemSearchWarehouseResolver = null;
function closeItemSearchModal(result = null) {
  const modal = $("#itemSearchModal");
  if (modal) modal.classList.add("hidden");
  const input = $("#itemSearchInput");
  const list = $("#itemSearchList");
  if (input) input.value = "";
  if (list) {
    list.innerHTML = "";
    list.classList.add("hidden");
  }
  itemSearchSelect = null;
  itemSearchWarehouseResolver = null;
  if (itemSearchResolve) {
    const done = itemSearchResolve;
    itemSearchResolve = null;
    done(result);
  }
}

async function runItemSearchModal() {
  const input = $("#itemSearchInput");
  const list = $("#itemSearchList");
  const runBtn = $("#itemSearchRun");
  if (!input || !list) return;
  const q = String(input.value || "").trim();
  if (q.length < 2) {
    showEntToast("Escribe al menos 2 caracteres para buscar.", "bad");
    markError(input);
    return;
  }
  if (runBtn) runBtn.disabled = true;
  list.classList.remove("hidden");
  list.innerHTML = `<div class="itemSearchEmpty">Buscando...</div>`;
  const warehouseId =
    typeof itemSearchWarehouseResolver === "function"
      ? Number(itemSearchWarehouseResolver() || 0)
      : 0;
  const items = await searchProducts(q, { warehouse: warehouseId > 0 ? warehouseId : null });
  if (runBtn) runBtn.disabled = false;
  if (!items.length) {
    list.innerHTML = `<div class="itemSearchEmpty">Sin coincidencias para "${q}".</div>`;
    return;
  }
  list.classList.remove("hidden");
  list.innerHTML = items
    .map(
      (p) =>
        `<div class="itemSearchRow" data-id="${p.id_producto}" data-name="${p.nombre_producto}" data-sku="${p.sku || ""}">
          <div>
            <div class="itemSearchName">${p.nombre_producto || ""}</div>
            <div class="itemSearchMeta">${p.sku ? `SKU: ${p.sku}` : "SKU: sin registro"}</div>
          </div>
          <div class="itemSearchPick">Seleccionar</div>
        </div>`
    )
    .join("");
  list.querySelectorAll(".itemSearchRow[data-id]").forEach((it) => {
    it.onclick = () => {
      if (typeof itemSearchSelect === "function") {
        itemSearchSelect({
          id_producto: Number(it.dataset.id || 0),
          nombre_producto: it.dataset.name || "",
          sku: it.dataset.sku || "",
        });
      }
      closeItemSearchModal(true);
    };
  });
}

function uiItemSearch({ title = "Buscar producto", initialQuery = "", onSelect, getWarehouseId = null } = {}) {
  const modal = $("#itemSearchModal");
  const titleEl = $("#itemSearchTitle");
  const input = $("#itemSearchInput");
  const list = $("#itemSearchList");
  if (!modal || !titleEl || !input || !list) {
    showEntToast("No se pudo abrir el buscador de items.", "bad");
    return Promise.resolve(false);
  }
  titleEl.textContent = title;
  input.value = String(initialQuery || "").trim();
  list.innerHTML = "";
  list.classList.add("hidden");
  itemSearchSelect = typeof onSelect === "function" ? onSelect : null;
  itemSearchWarehouseResolver = typeof getWarehouseId === "function" ? getWarehouseId : null;
  modal.classList.remove("hidden");
  const seedQuery = String(initialQuery || "").trim();
  setTimeout(() => {
    input.focus();
    // Si ya hay texto escrito al abrir, ejecuta busqueda inmediata.
    if (seedQuery.length >= 2) runItemSearchModal();
  }, 30);
  return new Promise((resolve) => {
    itemSearchResolve = resolve;
  });
}

function bindReportProductPicker(buttonSelector, inputSelector, title, onPickedSearch) {
  const btn = $(buttonSelector);
  const input = $(inputSelector);
  if (!btn || !input) return;
  btn.onclick = async () => {
    let picked = null;
    await uiItemSearch({
      title,
      initialQuery: btn.value || input.value || "",
      onSelect: async (p) => {
        picked = p || null;
        const pickedText = String(p?.name || p?.sku || "").trim();
        btn.value = pickedText;
        input.value = pickedText;
        const idTxt = String(p?.id || "");
        const skuTxt = String(p?.sku || "");
        btn.dataset.id = idTxt;
        btn.dataset.sku = skuTxt;
        input.dataset.id = idTxt;
        input.dataset.sku = skuTxt;
      },
    });
    if (!picked) return;
    if (typeof onPickedSearch === "function") await onPickedSearch();
  };
}

let supervisorResolve = null;
function closeSupervisorModal(result = null) {
  const modal = $("#supervisorModal");
  if (modal) modal.classList.add("hidden");
  if ($("#supervisorPinInput")) $("#supervisorPinInput").value = "";
  if (supervisorResolve) {
    const done = supervisorResolve;
    supervisorResolve = null;
    done(result);
  }
}

function uiSupervisorApproval(actionLabel = "accion sensible") {
  const modal = $("#supervisorModal");
  const title = $("#supervisorTitle");
  const pinInput = $("#supervisorPinInput");
  if (!modal || !title || !pinInput) {
    showEntToast("No se pudo abrir validacion de supervisor.", "bad");
    return Promise.resolve(null);
  }
  title.textContent = `Validacion supervisor: ${String(actionLabel || "accion sensible")}`;
  pinInput.value = "";
  modal.classList.remove("hidden");
  setTimeout(() => pinInput.focus(), 30);
  return new Promise((resolve) => {
    supervisorResolve = resolve;
  });
}

let closeDayPinResolve = null;
function closeCloseDayPinModal(result = null) {
  const modal = $("#closeDayPinModal");
  if (modal) modal.classList.add("hidden");
  if ($("#closeDayPinInput")) $("#closeDayPinInput").value = "";
  if (closeDayPinResolve) {
    const done = closeDayPinResolve;
    closeDayPinResolve = null;
    done(result);
  }
}

function uiCloseDaySupervisorPin() {
  const modal = $("#closeDayPinModal");
  const pinInput = $("#closeDayPinInput");
  if (!modal || !pinInput) {
    showEntToast("No se pudo abrir validacion de PIN para cierre.", "bad");
    return Promise.resolve(null);
  }
  pinInput.value = "";
  modal.classList.remove("hidden");
  setTimeout(() => pinInput.focus(), 30);
  return new Promise((resolve) => {
    closeDayPinResolve = resolve;
  });
}

if ($("#confirmOk")) {
  $("#confirmOk").onclick = () => closeConfirmModal(true);
}
if ($("#confirmCancel")) {
  $("#confirmCancel").onclick = () => closeConfirmModal(false);
}
if ($("#confirmModal")) {
  $("#confirmModal").addEventListener("click", (e) => {
    if (e.target?.id === "confirmModal") closeConfirmModal(false);
  });
}
if ($("#supervisorModal")) {
  $("#supervisorModal").addEventListener("click", (e) => {
    if (e.target?.id === "supervisorModal") closeSupervisorModal(null);
  });
}
if ($("#supervisorCancel")) {
  $("#supervisorCancel").onclick = () => closeSupervisorModal(null);
}
if ($("#supervisorOk")) {
  $("#supervisorOk").onclick = () => {
    const supervisor_pin = String($("#supervisorPinInput")?.value || "").trim();
    if (!/^\d{6,12}$/.test(supervisor_pin)) {
      showEntToast("El PIN del supervisor debe tener entre 6 y 12 digitos.", "bad");
      markError($("#supervisorPinInput"));
      return;
    }
    closeSupervisorModal({ supervisor_pin });
  };
}
if ($("#closeDayPinCancel")) {
  $("#closeDayPinCancel").onclick = () => closeCloseDayPinModal(null);
}
if ($("#closeDayPinOk")) {
  $("#closeDayPinOk").onclick = () => {
    const pin = String($("#closeDayPinInput")?.value || "").trim();
    if (!/^\d{6,12}$/.test(pin)) {
      showEntToast("El PIN del supervisor debe tener entre 6 y 12 digitos.", "bad");
      markError($("#closeDayPinInput"));
      return;
    }
    closeCloseDayPinModal({ supervisor_pin: pin });
  };
}
if ($("#closeDayPinModal")) {
  $("#closeDayPinModal").addEventListener("click", (e) => {
    if (e.target?.id === "closeDayPinModal") closeCloseDayPinModal(null);
  });
}
if ($("#itemSearchModal")) {
  $("#itemSearchModal").addEventListener("pointerdown", (e) => {
    if (e.target?.id === "itemSearchModal") closeItemSearchModal(false);
  });
}
if ($("#itemSearchCancel")) {
  $("#itemSearchCancel").onclick = () => closeItemSearchModal(false);
}
if ($("#itemSearchRun")) {
  $("#itemSearchRun").onclick = () => runItemSearchModal();
}
if ($("#itemSearchInput")) {
  $("#itemSearchInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runItemSearchModal();
    }
  });
}
document.addEventListener("keydown", (e) => {
  if (!$("#itemSearchModal")?.classList.contains("hidden")) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeItemSearchModal(false);
      return;
    }
    return;
  }
  if (!$("#closeDayPinModal")?.classList.contains("hidden")) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeCloseDayPinModal(null);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      $("#closeDayPinOk")?.click();
      return;
    }
  }
  if (!$("#supervisorModal")?.classList.contains("hidden")) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeSupervisorModal(null);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      $("#supervisorOk")?.click();
      return;
    }
  }
  if ($("#confirmModal")?.classList.contains("hidden")) return;
  if (e.key === "Escape") {
    e.preventDefault();
    closeConfirmModal(false);
  }
  if (e.key === "Enter") {
    e.preventDefault();
    closeConfirmModal(true);
  }
});

function markError(el) {
  if (!el) return;
  el.classList.add("field-error");
  clearTimeout(el._errTimer);
  el._errTimer = setTimeout(() => {
    el.classList.remove("field-error");
  }, 1200);
}

function isExpired(dateStr) {
  if (!dateStr) return false;
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const todayStr = `${yyyy}-${mm}-${dd}`;
  return dateStr < todayStr;
}

function setFechaHoraActual() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  if ($("#entFecha")) setDateInputValue($("#entFecha"), `${yyyy}-${mm}-${dd}`);
  if ($("#entHora")) $("#entHora").value = `${hh}:${mi}`;
  if ($("#salFecha")) setDateInputValue($("#salFecha"), `${yyyy}-${mm}-${dd}`);
  if ($("#salHora")) $("#salHora").value = `${hh}:${mi}`;
  if ($("#pedFecha")) setDateInputValue($("#pedFecha"), `${yyyy}-${mm}-${dd}`);
  if ($("#pedHora")) $("#pedHora").value = `${hh}:${mi}`;
}

function setFechaHoraPedidoActual() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  if ($("#pedFecha")) setDateInputValue($("#pedFecha"), `${yyyy}-${mm}-${dd}`);
  if ($("#pedHora")) $("#pedHora").value = `${hh}:${mi}`;
}

async function loadStockActual() {
  const id = $("#entProducto")?.dataset.id;
  if (!id) {
    if ($("#entStock")) $("#entStock").value = "";
    setEntradaPrecioSugerido(0);
    return;
  }
  setEntradaPrecioSugerido(0);
  try {
    const r = await fetch(`/api/productos/${id}/stock`, {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setEntradaPrecioSugerido(0);
      return;
    }
    if ($("#entStock")) $("#entStock").value = j.stock ?? 0;
    const suggested = Number(j.precio_sugerido || 0);
    setEntradaPrecioSugerido(suggested);
  } catch {
    setEntradaPrecioSugerido(0);
  }
}

const entList = [];
let entEditingIdx = null;
const salList = [];
let salPrecioSalidaObligatorio = false;
let proveedoresLoaded = false;
let motivosLoaded = false;
let motivosSalidaLoaded = false;
const salDestinosMap = new Map();
const pedList = [];
let pedUsersCatalog = [];
let bodegasLoaded = false;
let usuariosLoaded = false;
let usrRolesLoaded = false;
let usrBodegasLoaded = false;
let usrResetUsersLoaded = false;
let usrBodegasCatalog = [];
let prdVisibleWarehousesCatalog = [];
let prdCatalogosLoaded = false;
let subcatCatalogosLoaded = false;
let repExistBodegasLoaded = false;
let repExistCanView = true;
let repExistCanAllBodegas = false;
let repEntCatalogosLoaded = false;
let repEntCanView = true;
let repEntCanAllBodegas = false;
let repSalCatalogosLoaded = false;
let repSalCanView = true;
let repSalCanAllBodegas = false;
let repPedCatalogosLoaded = false;
let repPedCanView = true;
let repPedCanAllBodegas = false;
let repKarCatalogosLoaded = false;
let repKarCanView = true;
let repKarCanAllBodegas = false;
let repTrendWarehouseLoaded = false;
let repTrendCanView = true;
let repTrendCanAllBodegas = false;
let repDiaWarehouseLoaded = false;
let repDiaCanAllBodegas = false;
let repDiaRowsCache = [];
let repDiaApplyInFlight = false;
let repCuadreWarehouseLoaded = false;
let repCuadreCanAllBodegas = false;
let cuadreWarehouseLoaded = false;
let cuadreCanAllBodegas = false;
let cuadreDetailRows = [];
let cuadreSaveInFlight = false;
let salCountWarehouseLoaded = false;
let salCountCanAllBodegas = false;
let salCountRowsCache = [];
let salCountApplyInFlight = false;
let salCountWarehouseConfig = new Map();
let repCloseWarehouseLoaded = false;
let repCloseCanAllBodegas = false;
let repClosePrivilegeLoaded = false;
let repCloseSelectedDate = "";
let repCloseSelectedWarehouseId = 0;
let repCloseSelectedSummary = null;
let repCanCloseDay = false;
let repCloseDayInFlight = false;
let ajWarehouseLoaded = false;
let ajCanAllBodegas = false;
var repHeadFiltersBound = false;
var repExistAutoSearchTimer = null;
let repExistRowsCache = [];
let limCatalogosLoaded = false;
let regCatalogosLoaded = false;
const repExistExpanded = new Set();
var repExistCollapseBound = false;
var repExistMultiFiltersBound = false;
var prdCollapseBound = false;
var bodCollapseBound = false;
const bodegasMap = new Map();
const usrManageUsersMap = new Map();

async function searchProducts(q, opts = {}) {
  try {
    const qs = new URLSearchParams({ q: String(q || "") });
    const warehouse = Number(opts?.warehouse || 0);
    if (warehouse > 0) qs.set("warehouse", String(warehouse));
    const r = await fetch(`/api/productos/search?${qs.toString()}`, {
      headers: { Authorization: "Bearer " + token },
    });
    if (!r.ok) return [];
    return await r.json();
  } catch {
    return [];
  }
}

if ($("#entSearchBtn")) {
  $("#entSearchBtn").onclick = async () => {
    const input = $("#entProducto");
    await uiItemSearch({
      title: "Buscar producto para entrada",
      initialQuery: input?.value || "",
      getWarehouseId: () => Number(me?.id_warehouse || 0) || null,
      onSelect: async (p) => {
        if (!input) return;
        input.value = p.nombre_producto || "";
        input.dataset.id = String(p.id_producto || "");
        input.dataset.sku = p.sku || "";
        if ($("#entLote")) $("#entLote").value = "";
        clearDateInputValue($("#entCaducidad"));
        await loadStockActual();
      },
    });
  };
}

if ($("#entProducto")) {
  $("#entProducto").addEventListener("input", () => {
    $("#entProducto").dataset.id = "";
    $("#entProducto").dataset.sku = "";
    if ($("#entLote")) $("#entLote").value = "";
    clearDateInputValue($("#entCaducidad"));
    if ($("#entPrecio")) $("#entPrecio").value = "";
    setEntradaPrecioSugerido(0);
    updateEntradaTotal();
  });
  $("#entProducto").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    $("#entSearchBtn")?.click();
  });
}

async function loadBodegasPedido() {
  if (bodegasLoaded) return;
  const fromSel = $("#pedFromWarehouse");
  if (!fromSel) return;
  try {
    const r = await fetch("/api/bodegas", {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) return;
    bodegasMap.clear();
    rows.forEach((b) => bodegasMap.set(String(b.id_bodega), b));
    const allowed = rows.filter((b) => {
      if (Number(b.activo || 0) !== 1) return false;
      const tipo = String(b.tipo_bodega || "").toUpperCase();
      return tipo === "PRINCIPAL" || tipo === "RECEPTORA";
    });
    const opts =
      `<option value="">Seleccione bodega</option>` +
      allowed
        .map(
          (b) =>
            `<option value="${b.id_bodega}" data-tipo="${b.tipo_bodega || ""}">${b.nombre_bodega}</option>`
        )
        .join("");
    fromSel.innerHTML = opts;
    bodegasLoaded = true;
  } catch (e) { console.error('api_bodegas:', e); }
}

async function loadUsuariosPedido() {
  if (usuariosLoaded) return;
  const sel = $("#pedUser");
  if (!sel) return;
  try {
    const r = await fetch("/api/usuarios", {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) return;
    pedUsersCatalog = Array.isArray(rows) ? rows : [];
    renderPedidoUserOptions($("#pedUserSearch")?.value || "");
    usuariosLoaded = true;

    if (me?.id_user) {
      sel.value = String(me.id_user);
      onPedidoUserChange();
    }
  } catch (e) { console.error('api_roles:', e); }
}

function normalizePedidoUserFilter(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function renderPedidoUserOptions(filterText = "") {
  const sel = $("#pedUser");
  if (!sel) return;
  const currentValue = String(sel.value || "");
  const q = normalizePedidoUserFilter(filterText);
  const filtered = (Array.isArray(pedUsersCatalog) ? pedUsersCatalog : []).filter((u) => {
    if (!q) return true;
    const fullName = normalizePedidoUserFilter(u.full_name || "");
    const username = normalizePedidoUserFilter(u.username || "");
    return fullName.includes(q) || username.includes(q);
  });

  sel.innerHTML =
    `<option value="">Seleccione usuario</option>` +
    filtered
      .map(
        (u) =>
          `<option value="${u.id_user}" data-bodega="${u.id_warehouse || ""}" data-nombre="${u.full_name || ""}">${u.full_name || u.username || `#${u.id_user}`}</option>`
      )
      .join("");

  if (currentValue && filtered.some((u) => String(u.id_user) === currentValue)) {
    sel.value = currentValue;
  } else {
    sel.value = "";
  }
}

function updatePedidoTipo() {
  const typeInput = $("#pedRequesterType");
  const reqId = $("#pedRequesterWarehouseId")?.value || "";
  if (!typeInput) return;
  const b = bodegasMap.get(String(reqId));
  typeInput.value = b?.tipo_bodega || "";
}

async function onPedidoUserChange() {
  const userSel = $("#pedUser");
  const reqName = $("#pedRequesterWarehouseName");
  const reqIdInput = $("#pedRequesterWarehouseId");
  if (!userSel || !reqName || !reqIdInput) return;
  if (!bodegasLoaded) {
    await loadBodegasPedido();
  }
  const opt = userSel.options[userSel.selectedIndex];
  const idBodega = opt?.dataset?.bodega || "";
  const bodega = bodegasMap.get(String(idBodega));
  reqIdInput.value = idBodega ? String(idBodega) : "";
  reqName.value = bodega?.nombre_bodega || "";
  updatePedidoTipo();
}

if ($("#pedUser")) {
  $("#pedUser").addEventListener("change", onPedidoUserChange);
}
if ($("#pedUserSearch")) {
  $("#pedUserSearch").addEventListener("input", () => {
    renderPedidoUserOptions($("#pedUserSearch")?.value || "");
    onPedidoUserChange();
  });
}
if ($("#pedUserSearchBtn")) {
  $("#pedUserSearchBtn").onclick = () => {
    const input = $("#pedUserSearch");
    if (!input) return;
    renderPedidoUserOptions(input.value || "");
    onPedidoUserChange();
    input.focus();
    input.select();
  };
}

async function loadPedidoStock() {
  const id = $("#pedProducto")?.dataset.id;
  const wh = Number($("#pedFromWarehouse")?.value || 0);
  if (!id || !wh) {
    if ($("#pedStock")) $("#pedStock").value = "";
    return;
  }
  try {
    const r = await fetch(`/api/productos/${id}/stock?warehouse=${wh}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return;
    if ($("#pedStock")) $("#pedStock").value = j.stock ?? 0;
  } catch (e) { console.error('api_subcategorias:', e); }
}

if ($("#pedSearchBtn")) {
  $("#pedSearchBtn").onclick = async () => {
    const input = $("#pedProducto");
    await uiItemSearch({
      title: "Buscar producto para pedido",
      initialQuery: input?.value || "",
      getWarehouseId: () => Number($("#pedFromWarehouse")?.value || 0) || null,
      onSelect: async (p) => {
        if (!input) return;
        input.value = p.nombre_producto || "";
        input.dataset.id = String(p.id_producto || "");
        await loadPedidoStock();
      },
    });
  };
}

if ($("#pedProducto")) {
  $("#pedProducto").addEventListener("input", () => {
    $("#pedProducto").dataset.id = "";
  });
  $("#pedProducto").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    $("#pedSearchBtn")?.click();
  });
}

if ($("#pedFromWarehouse")) {
  $("#pedFromWarehouse").addEventListener("change", loadPedidoStock);
}

async function loadProveedores() {
  const sel = $("#entProveedor");
  if (!sel || proveedoresLoaded) return;
  try {
    const r = await fetch("/api/proveedores", {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) return;
    sel.innerHTML =
      `<option value="">Seleccione proveedor</option>` +
      rows.map((p) => `<option value="${p.id_proveedor}">${p.nombre_proveedor}</option>`).join("");
    proveedoresLoaded = true;
  } catch (e) { console.error('loadProveedoresEntrada:', e); }
}

async function loadMotivosEntrada() {
  const sel = $("#entMotivo");
  const selImport = $("#prdStockImportMotivo");
  const applyRows = (rows) => {
    const opts = `<option value="">Seleccione</option>` + rows.map((m) => `<option value="${m.id_motivo}">${m.nombre_motivo}</option>`).join("");
    if (sel) sel.innerHTML = opts;
    if (selImport) selImport.innerHTML = opts;
    const stockInit = rows.find((m) => normalizeImportKey(m.nombre_motivo).includes("stock_inicial"));
    if (selImport && stockInit) selImport.value = String(stockInit.id_motivo);
  };
  if (!sel && !selImport) return;
  if (motivosLoaded) {
    if (selImport && sel) selImport.innerHTML = sel.innerHTML;
    return;
  }
  try {
    const r = await fetch("/api/motivos?tipo=ENTRADA", {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) return;
    applyRows(rows);
    motivosLoaded = true;
  } catch (e) { console.error('api_bodegas:', e); }
}

function normalizeSalidaRuleText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isVentasNilasDestinoSelected() {
  const sel = $("#salDestino");
  if (!sel) return false;
  const idDestino = Number(sel.value || 0);
  const b = salDestinosMap.get(idDestino);
  const destinoNombre = String(b?.nombre_bodega || sel.options?.[sel.selectedIndex]?.textContent || "");
  return normalizeSalidaRuleText(destinoNombre) === "ventas nilas";
}

function applySalidaDestinoSpecialRules() {
  const isVentasNilas = isVentasNilasDestinoSelected();
  const obsLabel = $("#salObservacionLabel");
  const obsInput = $("#salObservacion");
  if (obsLabel) obsLabel.textContent = isVentasNilas ? "No Check" : "Observacion";
  if (obsInput) {
    obsInput.placeholder = isVentasNilas ? "No Check (obligatorio)" : "Observacion general";
    obsInput.required = isVentasNilas;
  }
}

function getTipoMovSalidaByDestino() {
  if (isVentasNilasDestinoSelected()) return "SALIDA";
  const idDestino = Number($("#salDestino")?.value || 0);
  if (!idDestino) return null;
  const myWarehouse = Number(me?.id_warehouse || 0);
  if (idDestino === myWarehouse) return "SALIDA";
  const d = salDestinosMap.get(idDestino);
  if (!d) return "SALIDA";
  const maneja_stock = Number(d.maneja_stock || 0) === 1;
  const puede_recibir = Number(d.puede_recibir || 0) === 1;
  const modo_transferencia = String(d.modo_despacho_auto || "").toUpperCase() === "TRANSFERENCIA";
  const es_receptora = String(d.tipo_bodega || "").toUpperCase() === "RECEPTORA";
  if (maneja_stock && puede_recibir && (modo_transferencia || es_receptora)) return "TRANSFERENCIA";
  return "SALIDA";
}

function findDefaultMotivoForVentasNilas(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const normalizedRows = rows.map((m) => ({
    ...m,
    _norm: normalizeSalidaRuleText(m?.nombre_motivo || ""),
  }));
  return (
    normalizedRows.find((m) => m._norm === "ventas nilas") ||
    normalizedRows.find((m) => m._norm === "venta nilas") ||
    normalizedRows.find((m) => m._norm.includes("venta") && m._norm.includes("nilas")) ||
    normalizedRows.find((m) => m._norm === "venta") ||
    null
  );
}

function isNilasWarehouseName(name) {
  const normalizedName = normalizeSalidaRuleText(name || "");
  return (
    normalizedName === "bodega nilas bakery" ||
    normalizedName === "nilas bakery" ||
    normalizedName.includes("nilas bakery")
  );
}

function isLoggedWarehouseNilas() {
  const currentName = String($("#salBodega")?.value || menuWarehouseLabel || "");
  return isNilasWarehouseName(currentName);
}

function findVentasNilasDestinoId() {
  for (const [idBodega, bodega] of salDestinosMap.entries()) {
    const normalizedName = normalizeSalidaRuleText(bodega?.nombre_bodega || "");
    if (normalizedName === "ventas nilas" || normalizedName.includes("ventas nilas")) {
      return String(idBodega);
    }
  }
  return "";
}

function applyDefaultSalidaDestinoForNilasUser() {
  const sel = $("#salDestino");
  if (!sel || !isLoggedWarehouseNilas()) return;
  if (String(sel.value || "").trim()) return;
  const ventasNilasId = findVentasNilasDestinoId();
  if (!ventasNilasId) return;
  sel.value = ventasNilasId;
  applySalidaDestinoSpecialRules();
  motivosSalidaLoaded = false;
}

function applyConfiguredDefaultSalidaDestino() {
  const sel = $("#salDestino");
  if (!sel) return;
  if (String(sel.value || "").trim()) return;
  const myWarehouse = Number(me?.id_warehouse || 0);
  if (!myWarehouse) return;
  const currentCfg = salDestinosMap.get(myWarehouse);
  const defaultDestinoId = Number(currentCfg?.id_bodega_destino_default || 0);
  if (!defaultDestinoId) return;
  if (!salDestinosMap.has(defaultDestinoId)) return;
  sel.value = String(defaultDestinoId);
  applySalidaDestinoSpecialRules();
  motivosSalidaLoaded = false;
}

async function loadBodegasSalida() {
  const sel = $("#salDestino");
  if (!sel) return;
  try {
    const r = await fetch("/api/bodegas", {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) return;
    salDestinosMap.clear();
    const destinos = rows.filter((b) => Number(b.activo || 0) === 1);
    destinos.forEach((b) => salDestinosMap.set(Number(b.id_bodega), b));
    sel.innerHTML =
      `<option value="">Seleccione bodega destino</option>` +
      destinos.map((b) => `<option value="${b.id_bodega}">${b.nombre_bodega}</option>`).join("");
    applyConfiguredDefaultSalidaDestino();
    applyDefaultSalidaDestinoForNilasUser();
  } catch (e) { console.error('api_subcategorias:', e); }
}

async function loadMotivosSalida() {
  const sel = $("#salMotivo");
  if (!sel || motivosSalidaLoaded) return;
  const tipo = getTipoMovSalidaByDestino();
  if (!tipo) {
    sel.innerHTML = `<option value="">Seleccione destino primero</option>`;
    if ($("#salTipoMov")) $("#salTipoMov").value = "";
    return;
  }
  try {
    const r = await fetch(`/api/motivos?tipo=${encodeURIComponent(tipo)}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) return;
    sel.innerHTML =
      `<option value="">Seleccione</option>` +
      rows.map((m) => `<option value="${m.id_motivo}">${m.nombre_motivo}</option>`).join("");
    if (isVentasNilasDestinoSelected()) {
      const motivoNilas = findDefaultMotivoForVentasNilas(rows);
      if (motivoNilas) sel.value = String(motivoNilas.id_motivo);
    }
    if ($("#salTipoMov")) $("#salTipoMov").value = tipo;
    motivosSalidaLoaded = true;
  } catch (e) { console.error('loadMotivosSalida:', e); }
}

if ($("#salDestino")) {
  $("#salDestino").addEventListener("change", () => {
    applySalidaDestinoSpecialRules();
    motivosSalidaLoaded = false;
    loadMotivosSalida();
  });
}
applySalidaDestinoSpecialRules();

loadProveedores();
loadMotivosEntrada();
loadMotivosSalida();

async function loadBodegaUsuario() {
  if (!me?.id_warehouse) return;
  try {
    const r = await fetch(`/api/bodegas/${me.id_warehouse}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return;
    const bodegaNombre = j.nombre_bodega || "Sin bodega";
    if ($("#entBodega")) $("#entBodega").value = bodegaNombre;
    menuWarehouseLabel = bodegaNombre;
    renderMenuUserLabel();
  } catch (e) { console.error('loadBodegaUsuario:', e); }
}

loadBodegaUsuario();

function updateSalidaPrecioRequirementUI() {
  const lbl = $("#salPrecioLabel");
  const inp = $("#salPrecio");
  if (lbl) lbl.textContent = salPrecioSalidaObligatorio ? "Precio salida *" : "Precio salida";
  if (inp) inp.placeholder = salPrecioSalidaObligatorio ? "Obligatorio" : "";
}

async function loadBodegaUsuarioSalida() {
  if (!me?.id_warehouse) return;
  try {
    const r = await fetch(`/api/bodegas/${me.id_warehouse}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return;
    const bodegaNombre = j.nombre_bodega || "Sin bodega";
    salPrecioSalidaObligatorio = Number(j.requiere_precio_salida || 0) === 1;
    updateSalidaPrecioRequirementUI();
    if ($("#salBodega")) $("#salBodega").value = bodegaNombre;
    menuWarehouseLabel = bodegaNombre;
    renderMenuUserLabel();
    applyDefaultSalidaDestinoForNilasUser();
    if (isVentasNilasDestinoSelected()) loadMotivosSalida();
  } catch (e) { console.error('loadBodegaUsuarioSalida:', e); }
}

loadBodegaUsuarioSalida();

async function loadCorrelativoSalidaDocumento() {
  const inp = $("#salDocumento");
  if (!inp) return;
  try {
    const r = await fetch("/api/pedidos/correlativo-actual", {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return;
    inp.value = Number(j.correlativo || 0) > 0 ? String(j.correlativo) : "";
  } catch (e) { console.error('api_motivos:', e); }
}

loadCorrelativoSalidaDocumento();

async function loadExistenciasBodegasFilter() {
  if (repExistBodegasLoaded) return;
  const sel = $("#repExistWarehouse");
  const catSel = $("#repExistCategoria");
  const subSel = $("#repExistSubcategoria");
  if (!sel || !catSel || !subSel) return;
  try {
    const [r, catR] = await Promise.all([
      fetch("/api/reportes/stock-scope", {
        headers: { Authorization: "Bearer " + token },
      }),
      fetch("/api/categorias", {
        headers: { Authorization: "Bearer " + token },
      }),
    ]);
    const j = await r.json().catch(() => ({}));
    const catRows = await catR.json().catch(() => []);
    if (!r.ok) return;
    const rows = Array.isArray(j.bodegas) ? j.bodegas : [];
    repExistCanView = Number(j.can_view_existencias) === 1 || j.can_view_existencias === true;
    repExistCanAllBodegas = Number(j.can_all_bodegas) === 1 || j.can_all_bodegas === true;
    if (!repExistCanView) {
      sel.innerHTML = `<option value="">Sin acceso</option>`;
      sel.disabled = true;
    } else if (repExistCanAllBodegas) {
      sel.innerHTML =
        `<option value="">Todas las bodegas</option>` +
        rows.map((b) => `<option value="${b.id_bodega}">${b.nombre_bodega}</option>`).join("");
      sel.disabled = false;
    } else {
      sel.innerHTML = rows.map((b) => `<option value="${b.id_bodega}">${b.nombre_bodega}</option>`).join("");
      if (Number(j.id_bodega_default || 0)) sel.value = String(j.id_bodega_default);
      sel.disabled = true;
    }
    if (catR.ok) {
      const rowsCat = Array.isArray(catRows) ? catRows : [];
      catSel.innerHTML =
        `<option value="">Todas las categorias</option>` +
        rowsCat.map((c) => `<option value="${c.id_categoria}">${c.nombre_categoria}</option>`).join("");
    }
    subSel.innerHTML = `<option value="">Todas las subcategorias</option>`;
    repExistBodegasLoaded = true;
  } catch (e) { console.error('api_productos:', e); }
}

async function loadReporteExistenciasSubcategorias() {
  const catId = Number($("#repExistCategoria")?.value || 0);
  const sel = $("#repExistSubcategoria");
  if (!sel) return;
  if (!catId) {
    sel.innerHTML = `<option value="">Todas las subcategorias</option>`;
    return;
  }
  try {
    const r = await fetch(`/api/subcategorias?categoria=${encodeURIComponent(catId)}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) return;
    sel.innerHTML =
      `<option value="">Todas las subcategorias</option>` +
      rows.map((s) => `<option value="${s.id_subcategoria}">${s.nombre_subcategoria}</option>`).join("");
  } catch (e) { console.error('api_subcategorias:', e); }
}

async function loadReporteCuadreWarehouseFilter(force = false) {
  const sel = $("#repCuadreWarehouse");
  if (!sel) return;
  if (repCuadreWarehouseLoaded && !force) return;
  try {
    const r = await fetch("/api/cuadre-caja/context", {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return;
    const rows = Array.isArray(j.bodegas) ? j.bodegas : [];
    repCuadreCanAllBodegas = Number(j.can_all_bodegas) === 1 || j.can_all_bodegas === true;
    if (repCuadreCanAllBodegas) {
      sel.innerHTML = `<option value="">Todas las bodegas</option>` +
        rows.map((b) => `<option value="${b.id_bodega}">${escapeHtml(b.nombre_bodega || "")}</option>`).join("");
      sel.disabled = false;
      if (Number(j.id_bodega_default || 0) > 0) sel.value = String(j.id_bodega_default);
    } else {
      sel.innerHTML = rows.map((b) => `<option value="${b.id_bodega}">${escapeHtml(b.nombre_bodega || "")}</option>`).join("");
      if (Number(j.id_bodega_default || 0) > 0) sel.value = String(j.id_bodega_default);
      sel.disabled = true;
    }
    repCuadreWarehouseLoaded = true;
  } catch (e) { console.error('loadCuadreWarehouseFilter:', e); }
}

function openStoredCuadrePrint(fecha, idBodega = 0, format = "carta") {
  const fmt = String(format || "carta").toLowerCase() === "pos" ? "pos" : "carta";
  const qs = new URLSearchParams({
    token: token || "",
    fecha: String(fecha || "").trim(),
    format: fmt,
  });
  if (Number(idBodega || 0) > 0) qs.set("warehouse", String(Number(idBodega || 0)));
  window.open(`${API_ORIGIN}/api/print/cuadre-caja?${qs.toString()}`, "_blank");
}

async function openCuadreRecordFromReport(fecha, idBodega = 0) {
  if (!String(fecha || "").trim()) return;
  if (currentSection !== "cuadre-caja") {
    document.querySelector('.menuBtn[data-section="cuadre-caja"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  await loadCuadreWarehouseFilter();
  if ($("#cuadreFecha")) setDateInputValue($("#cuadreFecha"), String(fecha || "").trim());
  if ($("#cuadreWarehouse") && Number(idBodega || 0) > 0) {
    $("#cuadreWarehouse").value = String(Number(idBodega || 0));
  }
  await loadCuadreCaja();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function loadReporteCuadresCaja() {
  await loadReporteCuadreWarehouseFilter();
  const tb = $("#repCuadreList");
  const resume = $("#repCuadreResume");
  if (!tb) return;
  const fecha = toYmd($("#repCuadreFecha")?.value || "") || "";
  const responsable = String($("#repCuadreResponsable")?.value || "").trim();
  const warehouse = Number($("#repCuadreWarehouse")?.value || 0) || "";
  const qs = new URLSearchParams({ limit: "200" });
  if (fecha) qs.set("fecha", fecha);
  if (responsable) qs.set("responsable", responsable);
  if (warehouse) qs.set("warehouse", String(warehouse));
  tb.innerHTML = `<tr><td colspan="9">Cargando...</td></tr>`;
  try {
    const r = await fetch(`/api/reportes/cuadre-caja?${qs.toString()}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      tb.innerHTML = `<tr><td colspan="9">${escapeHtml(j?.error || "Error al cargar reporte.")}</td></tr>`;
      if (resume) resume.innerHTML = `<span class="pill ghost">Error</span>`;
      return;
    }
    const rows = Array.isArray(j.rows) ? j.rows : [];
    if (!rows.length) {
      tb.innerHTML = `<tr><td colspan="9">Sin cuadres para esos filtros.</td></tr>`;
      if (resume) resume.innerHTML = `<span class="pill ghost">Sin resultados</span>`;
      return;
    }
    if (resume) {
      resume.innerHTML = `
        <span class="pill ghost">Registros: <strong>${rows.length}</strong></span>
        <span class="pill ghost">Filtro fecha: <strong>${fecha ? fmtDateOnly(fecha) : "Todas"}</strong></span>
        <span class="pill ghost">Responsable: <strong>${escapeHtml(responsable || "Todos")}</strong></span>
      `;
    }
    tb.innerHTML = rows.map((row) => {
      const rowFecha = toYmd(row.fecha) || String(row.fecha || "").trim();
      return `
      <tr>
        <td>${fmtDateOnly(rowFecha)}</td>
        <td>${escapeHtml(row.nombre_bodega || row.sede || "-")}</td>
        <td>${escapeHtml(row.responsable || "-")}</td>
        <td>${fmtMoney(row.total_efectivo || 0)}</td>
        <td>${fmtMoney(row.total_cobro || 0)}</td>
        <td>${fmtMoney(row.total_venta_ambiente || 0)}</td>
        <td>${fmtMoney(row.gran_total_reporte || 0)}</td>
        <td>${fmtDateTime(row.actualizado_en)}</td>
        <td>
          <div class="addRow" style="justify-content:flex-start; gap:6px;">
            <button class="btn soft btn-sm" data-rep-cuadre-open="${escapeHtml(rowFecha)}" data-rep-cuadre-wh="${Number(row.id_bodega || 0)}" type="button">Cargar</button>
            <button class="btn soft btn-sm" data-rep-cuadre-pos="${escapeHtml(rowFecha)}" data-rep-cuadre-wh="${Number(row.id_bodega || 0)}" type="button">POS</button>
            <button class="btn soft btn-sm" data-rep-cuadre-carta="${escapeHtml(rowFecha)}" data-rep-cuadre-wh="${Number(row.id_bodega || 0)}" type="button">Carta</button>
          </div>
        </td>
      </tr>
    `;
    }).join("");
    tb.querySelectorAll("[data-rep-cuadre-open]").forEach((btn) => {
      btn.onclick = () => openCuadreRecordFromReport(btn.dataset.repCuadreOpen || "", Number(btn.dataset.repCuadreWh || 0));
    });
    tb.querySelectorAll("[data-rep-cuadre-pos]").forEach((btn) => {
      btn.onclick = () => openStoredCuadrePrint(btn.dataset.repCuadrePos || "", Number(btn.dataset.repCuadreWh || 0), "pos");
    });
    tb.querySelectorAll("[data-rep-cuadre-carta]").forEach((btn) => {
      btn.onclick = () => openStoredCuadrePrint(btn.dataset.repCuadreCarta || "", Number(btn.dataset.repCuadreWh || 0), "carta");
    });
  } catch {
    tb.innerHTML = `<tr><td colspan="9">Error de red.</td></tr>`;
    if (resume) resume.innerHTML = `<span class="pill ghost">Error de red</span>`;
  }
}

if ($("#repCuadreSearch")) {
  $("#repCuadreSearch").onclick = () => loadReporteCuadresCaja();
}
if ($("#repCuadreClear")) {
  $("#repCuadreClear").onclick = async () => {
    if ($("#repCuadreFecha")) $("#repCuadreFecha").value = "";
    if ($("#repCuadreResponsable")) $("#repCuadreResponsable").value = "";
    repCuadreWarehouseLoaded = false;
    await loadReporteCuadreWarehouseFilter(true);
    if ($("#repCuadreList")) $("#repCuadreList").innerHTML = `<tr><td colspan="9">Usa los filtros y presiona Buscar.</td></tr>`;
    if ($("#repCuadreResume")) $("#repCuadreResume").innerHTML = `<span class="pill ghost">Usa los filtros y presiona Buscar.</span>`;
  };
}
if ($("#repCuadreResponsable")) {
  $("#repCuadreResponsable").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      loadReporteCuadresCaja();
    }
  });
}

async function loadReporteEntradasCatalogos() {
  if (repEntCatalogosLoaded) return;
  const whSel = $("#repEntWarehouse");
  const catSel = $("#repEntCategoria");
  const motivoSel = $("#repEntMotivo");
  if (!whSel || !catSel || !motivoSel) return;

  try {
    const [scopeR, catR, motR] = await Promise.all([
      fetch("/api/reportes/stock-scope", {
        headers: { Authorization: "Bearer " + token },
      }),
      fetch("/api/categorias", {
        headers: { Authorization: "Bearer " + token },
      }),
      fetch("/api/motivos", {
        headers: { Authorization: "Bearer " + token },
      }),
    ]);
    const scopeJ = await scopeR.json().catch(() => ({}));
    const catRows = await catR.json().catch(() => []);
    const motRows = await motR.json().catch(() => []);

    if (scopeR.ok) {
      const rows = Array.isArray(scopeJ.bodegas) ? scopeJ.bodegas : [];
      repEntCanView = Number(scopeJ.can_view_existencias) === 1 || scopeJ.can_view_existencias === true;
      repEntCanAllBodegas = Number(scopeJ.can_all_bodegas) === 1 || scopeJ.can_all_bodegas === true;
      if (!repEntCanView) {
        whSel.innerHTML = `<option value="">Sin acceso</option>`;
        whSel.disabled = true;
      } else if (repEntCanAllBodegas) {
        whSel.innerHTML =
          `<option value="">Todas las bodegas</option>` +
          rows.map((b) => `<option value="${b.id_bodega}">${b.nombre_bodega}</option>`).join("");
        whSel.disabled = false;
      } else {
        whSel.innerHTML = rows.map((b) => `<option value="${b.id_bodega}">${b.nombre_bodega}</option>`).join("");
        if (Number(scopeJ.id_bodega_default || 0)) whSel.value = String(scopeJ.id_bodega_default);
        whSel.disabled = true;
      }
    }

    if (catR.ok) {
      const rows = Array.isArray(catRows) ? catRows : [];
      catSel.innerHTML =
        `<option value="">Todas las categorias</option>` +
        rows.map((c) => `<option value="${c.id_categoria}">${c.nombre_categoria}</option>`).join("");
    }

    if (motR.ok) {
      const rows = Array.isArray(motRows) ? motRows : [];
      motivoSel.innerHTML =
        `<option value="">Todos los motivos</option>` +
        `<option value="TRANSFERENCIA">Transferencia</option>` +
        rows.map((m) => `<option value="${m.id_motivo}">${m.nombre_motivo}</option>`).join("");
    }

    repEntCatalogosLoaded = true;
  } catch (e) { console.error('loadReporteEntradasCatalogos:', e); }
}

async function loadReporteEntradasSubcategorias() {
  const catId = Number($("#repEntCategoria")?.value || 0);
  const sel = $("#repEntSubcategoria");
  if (!sel) return;
  if (!catId) {
    sel.innerHTML = `<option value="">Todas las subcategorias</option>`;
    return;
  }
  try {
    const r = await fetch(`/api/subcategorias?categoria=${encodeURIComponent(catId)}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) return;
    sel.innerHTML =
      `<option value="">Todas las subcategorias</option>` +
      rows.map((s) => `<option value="${s.id_subcategoria}">${s.nombre_subcategoria}</option>`).join("");
  } catch (e) { console.error('loadReporteEntradasSubcategorias:', e); }
}

async function loadReporteSalidasCatalogos() {
  if (repSalCatalogosLoaded) return;
  const whSel = $("#repSalWarehouse");
  const whDestinoSel = $("#repSalWarehouseDestino");
  const catSel = $("#repSalCategoria");
  const motivoSel = $("#repSalMotivo");
  if (!whSel || !whDestinoSel || !catSel || !motivoSel) return;

  try {
    const [scopeR, catR, bodR, motR] = await Promise.all([
      fetch("/api/reportes/stock-scope", {
        headers: { Authorization: "Bearer " + token },
      }),
      fetch("/api/categorias", {
        headers: { Authorization: "Bearer " + token },
      }),
      fetch("/api/bodegas", {
        headers: { Authorization: "Bearer " + token },
      }),
      fetch("/api/motivos", {
        headers: { Authorization: "Bearer " + token },
      }),
    ]);
    const scopeJ = await scopeR.json().catch(() => ({}));
    const catRows = await catR.json().catch(() => []);
    const bodRows = await bodR.json().catch(() => []);
    const motRows = await motR.json().catch(() => []);

    if (scopeR.ok) {
      const rows = Array.isArray(scopeJ.bodegas) ? scopeJ.bodegas : [];
      repSalCanView = Number(scopeJ.can_view_existencias) === 1 || scopeJ.can_view_existencias === true;
      repSalCanAllBodegas = Number(scopeJ.can_all_bodegas) === 1 || scopeJ.can_all_bodegas === true;
      if (!repSalCanView) {
        whSel.innerHTML = `<option value="">Sin acceso</option>`;
        whSel.disabled = true;
      } else if (repSalCanAllBodegas) {
        whSel.innerHTML =
          `<option value="">Todas las bodegas</option>` +
          rows.map((b) => `<option value="${b.id_bodega}">${b.nombre_bodega}</option>`).join("");
        whSel.disabled = false;
      } else {
        whSel.innerHTML = rows.map((b) => `<option value="${b.id_bodega}">${b.nombre_bodega}</option>`).join("");
        if (Number(scopeJ.id_bodega_default || 0)) whSel.value = String(scopeJ.id_bodega_default);
        whSel.disabled = true;
      }
    }

    if (catR.ok) {
      const rows = Array.isArray(catRows) ? catRows : [];
      catSel.innerHTML =
        `<option value="">Todas las categorias</option>` +
        rows.map((c) => `<option value="${c.id_categoria}">${c.nombre_categoria}</option>`).join("");
    }

    if (bodR.ok) {
      const rows = Array.isArray(bodRows) ? bodRows : [];
      whDestinoSel.innerHTML =
        `<option value="">Todas las bodegas destino</option>` +
        rows.map((b) => `<option value="${b.id_bodega}">${b.nombre_bodega}</option>`).join("");
    }

    if (motR.ok) {
      const rows = Array.isArray(motRows) ? motRows : [];
      motivoSel.innerHTML =
        `<option value="">Todos los motivos</option>` +
        `<option value="TRANSFERENCIA">Transferencia</option>` +
        rows.map((m) => `<option value="${m.id_motivo}">${m.nombre_motivo}</option>`).join("");
    }

    repSalCatalogosLoaded = true;
  } catch (e) { console.error('loadStockSalidaActual:', e); }
}

async function loadReporteSalidasSubcategorias() {
  const catId = Number($("#repSalCategoria")?.value || 0);
  const sel = $("#repSalSubcategoria");
  if (!sel) return;
  if (!catId) {
    sel.innerHTML = `<option value="">Todas las subcategorias</option>`;
    return;
  }
  try {
    const r = await fetch(`/api/subcategorias?categoria=${encodeURIComponent(catId)}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) return;
    sel.innerHTML =
      `<option value="">Todas las subcategorias</option>` +
      rows.map((s) => `<option value="${s.id_subcategoria}">${s.nombre_subcategoria}</option>`).join("");
  } catch (e) { console.error('api_subcategorias:', e); }
}

async function loadReportePedidosCatalogos() {
  if (repPedCatalogosLoaded) return;
  const whReq = $("#repPedWarehouseReq");
  const whDesp = $("#repPedWarehouseDesp");
  const catSel = $("#repPedCategoria");
  const reqUserSel = $("#repPedRequesterUser");
  const dspUserSel = $("#repPedDispatchUser");
  if (!whReq || !whDesp || !catSel || !reqUserSel || !dspUserSel) return;

  try {
    const [scopeR, bodR, catR, usrR] = await Promise.all([
      fetch("/api/reportes/stock-scope", {
        headers: { Authorization: "Bearer " + token },
      }),
      fetch("/api/bodegas", {
        headers: { Authorization: "Bearer " + token },
      }),
      fetch("/api/categorias", {
        headers: { Authorization: "Bearer " + token },
      }),
      fetch("/api/usuarios", {
        headers: { Authorization: "Bearer " + token },
      }),
    ]);
    const scopeJ = await scopeR.json().catch(() => ({}));
    const bodRows = await bodR.json().catch(() => []);
    const catRows = await catR.json().catch(() => []);
    const usrRows = await usrR.json().catch(() => []);

    if (scopeR.ok) {
      const rows = Array.isArray(scopeJ.bodegas) ? scopeJ.bodegas : [];
      const requesterRows = Array.isArray(bodRows) ? bodRows : [];
      repPedCanView = Number(scopeJ.can_view_existencias) === 1 || scopeJ.can_view_existencias === true;
      repPedCanAllBodegas = Number(scopeJ.can_all_bodegas) === 1 || scopeJ.can_all_bodegas === true;
      if (!repPedCanView) {
        whReq.innerHTML = `<option value="">Sin acceso</option>`;
        whDesp.innerHTML = `<option value="">Sin acceso</option>`;
        whReq.disabled = true;
        whDesp.disabled = true;
      } else if (repPedCanAllBodegas) {
        const html =
          `<option value="">Todas las bodegas</option>` +
          rows.map((b) => `<option value="${b.id_bodega}">${b.nombre_bodega}</option>`).join("");
        whReq.innerHTML =
          `<option value="">Todas las bodegas</option>` +
          requesterRows.map((b) => `<option value="${b.id_bodega}">${b.nombre_bodega}</option>`).join("");
        whDesp.innerHTML = html;
        whReq.disabled = false;
        whDesp.disabled = false;
      } else {
        whReq.innerHTML =
          `<option value="">Todas las bodegas</option>` +
          requesterRows.map((b) => `<option value="${b.id_bodega}">${b.nombre_bodega}</option>`).join("");
        whReq.disabled = false;
        const html = rows.map((b) => `<option value="${b.id_bodega}">${b.nombre_bodega}</option>`).join("");
        whDesp.innerHTML = html;
        if (Number(scopeJ.id_bodega_default || 0)) {
          const v = String(scopeJ.id_bodega_default);
          whDesp.value = v;
        }
        whDesp.disabled = true;
      }
    }


    if (catR.ok) {
      const rows = Array.isArray(catRows) ? catRows : [];
      catSel.innerHTML =
        `<option value="">Todas las categorias</option>` +
        rows.map((c) => `<option value="${c.id_categoria}">${c.nombre_categoria}</option>`).join("");
    }

    if (usrR.ok) {
      const rows = Array.isArray(usrRows) ? usrRows : [];
      const html =
        `<option value="">Todos</option>` +
        rows.map((u) => `<option value="${u.id_user}">${u.full_name || u.username || `#${u.id_user}`}</option>`).join("");
      reqUserSel.innerHTML = html;
      dspUserSel.innerHTML = html;
    }

    repPedCatalogosLoaded = true;
  } catch (e) { console.error('loadReportePedidosCatalogos:', e); }
}

async function loadReportePedidosSubcategorias() {
  const catId = Number($("#repPedCategoria")?.value || 0);
  const sel = $("#repPedSubcategoria");
  if (!sel) return;
  if (!catId) {
    sel.innerHTML = `<option value="">Todas las subcategorias</option>`;
    return;
  }
  try {
    const r = await fetch(`/api/subcategorias?categoria=${encodeURIComponent(catId)}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) return;
    sel.innerHTML =
      `<option value="">Todas las subcategorias</option>` +
      rows.map((s) => `<option value="${s.id_subcategoria}">${s.nombre_subcategoria}</option>`).join("");
  } catch (e) { console.error('api_subcategorias:', e); }
}

async function loadStockSalidaActual() {
  const id = $("#salProducto")?.dataset.id;
  if (!id) {
    if ($("#salStock")) $("#salStock").value = "";
    return;
  }
  try {
    const r = await fetch(`/api/productos/${id}/stock`, {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return;
    if ($("#salStock")) $("#salStock").value = j.stock ?? 0;
  } catch (e) { console.error('loadStockSalidaActual:', e); }
}

if ($("#salSearchBtn")) {
  $("#salSearchBtn").onclick = async () => {
    const input = $("#salProducto");
    await uiItemSearch({
      title: "Buscar producto para salida",
      initialQuery: input?.value || "",
      getWarehouseId: () => Number(me?.id_warehouse || 0) || null,
      onSelect: async (p) => {
        if (!input) return;
        input.value = p.nombre_producto || "";
        input.dataset.id = String(p.id_producto || "");
        await loadStockSalidaActual();
      },
    });
  };
}

if ($("#salProducto")) {
  $("#salProducto").addEventListener("input", () => {
    $("#salProducto").dataset.id = "";
  });
  $("#salProducto").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    $("#salSearchBtn")?.click();
  });
}

function existenciaEstadoText(dias, moveDays) {
  if (dias === null || dias === undefined) return "Sin fecha";
  const n = Number(dias);
  if (n < 0) return "Vencido";
  if (n <= Number(moveDays || 0)) return "Mover pronto";
  return "En rango";
}

function existenciaBadge(dias, moveDays) {
  const st = existenciaEstadoText(dias, moveDays);
  if (st === "Vencido") return `<span class="badgeTag warn">Vencido</span>`;
  if (st === "Mover pronto") return `<span class="badgeTag partial">Mover pronto</span>`;
  if (st === "En rango") return `<span class="badgeTag ok">En rango</span>`;
  return `<span class="badgeTag">Sin fecha</span>`;
}

function alertAction(dias, moveDays) {
  if (dias === null || dias === undefined) return "Revisar lote";
  const n = Number(dias);
  if (n < 0) return "Retirar";
  if (n <= Number(moveDays || 0)) return "Mover ya";
  return "Monitorear";
}

function reglaEstadoText(remDias, alertaAntes, maxDiasVida) {
  const maxVida = Number(maxDiasVida || 0);
  if (!maxVida || maxVida <= 0) return "Sin regla";
  const rem = remDias === null || remDias === undefined ? null : Number(remDias);
  if (rem === null || !Number.isFinite(rem)) return "Sin regla";
  const alertDays = Math.max(0, Number(alertaAntes || 0));
  if (rem < 0) return "Excedido";
  if (rem <= alertDays) return "Mover por regla";
  return "Vigente por regla";
}

function reglaBadge(remDias, alertaAntes, maxDiasVida) {
  const st = reglaEstadoText(remDias, alertaAntes, maxDiasVida);
  if (st === "Excedido") {
    return `<span class="statusLight red" title="Excedido"><span class="dot"></span><span>&#9760;</span></span>`;
  }
  if (st === "Mover por regla") {
    return `<span class="statusLight amber" title="Mover por regla"><span class="dot"></span><span>&#9888;</span></span>`;
  }
  if (st === "Vigente por regla") {
    return `<span class="statusLight green" title="Vigente por regla"><span class="dot"></span><span>OK</span></span>`;
  }
  return `<span class="statusLight neutral" title="Sin regla"><span class="dot"></span><span>-</span></span>`;
}

function alertSemaforoBadge(dias) {
  if (dias === null || dias === undefined) {
    return `<span class="statusLight neutral"><span class="dot"></span><span>Sin fecha</span></span>`;
  }
  const n = Number(dias);
  if (n < 0) {
    return `<span class="statusLight red"><span class="dot"></span><span>Vencido</span></span>`;
  }
  if (n <= 7) {
    return `<span class="statusLight amber"><span class="dot"></span><span>Proximo a vencer</span></span>`;
  }
  return `<span class="statusLight green"><span class="dot"></span><span>Vigente</span></span>`;
}

function alertIndicadores(x) {
  const venc = alertSemaforoBadge(x.dias_para_vencer);
  const regla = reglaBadge(x.dias_restantes_regla, x.dias_alerta_antes, x.max_dias_vida);
  return `<div class="statusGroup">${venc}${regla}</div>`;
}

function stockNivelText(stockTotal, minimoStock, maximoStock) {
  const stock = Number(stockTotal || 0);
  const min = Number(minimoStock || 0);
  const max = Number(maximoStock || 0);
  if (stock < min) return "Bajo Minimo";
  if (min > 0 && stock === min + 1) return "Por llegar al minimo";
  if (max > 0 && stock > max) return "Sobre maximo";
  return "";
}

function stockNivelBadge(stockTotal, minimoStock, maximoStock) {
  const st = stockNivelText(stockTotal, minimoStock, maximoStock);
  if (st === "Bajo Minimo") return `<span class="statusLight red"><span class="dot"></span><span>${st}</span></span>`;
  if (st === "Por llegar al minimo") {
    return `<span class="statusLight amber"><span class="dot"></span><span>${st}</span></span>`;
  }
  if (st === "Sobre maximo") return `<span class="statusLight blue"><span class="dot"></span><span>${st}</span></span>`;
  return "";
}

function groupExistencias(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const key = `${r.id_bodega}|${r.id_producto}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        id_bodega: r.id_bodega,
        nombre_bodega: r.nombre_bodega || "",
        id_producto: r.id_producto,
        nombre_producto: r.nombre_producto || "",
        sku: r.sku || "",
        stock_total: 0,
        total_dinero: 0,
        minimo_stock: Number(r.minimo_stock || 0),
        maximo_stock: Number(r.maximo_stock || 0),
        min_dias: null,
        max_dias_vida: Number(r.max_dias_vida || 0),
        dias_alerta_antes: Number(r.dias_alerta_antes || 0),
        min_dias_regla: null,
        lotes: [],
      });
    }
    const g = map.get(key);
    const stock = Number(r.stock || 0);
    const totalLinea = Number(r.total_linea || 0);
    const dias = r.dias_para_vencer === null || r.dias_para_vencer === undefined ? null : Number(r.dias_para_vencer);
    g.stock_total += stock;
    g.total_dinero += totalLinea;
    if (!g.minimo_stock && Number(r.minimo_stock || 0) > 0) g.minimo_stock = Number(r.minimo_stock || 0);
    if (!g.maximo_stock && Number(r.maximo_stock || 0) > 0) g.maximo_stock = Number(r.maximo_stock || 0);
    if (dias !== null && Number.isFinite(dias)) {
      g.min_dias = g.min_dias === null ? dias : Math.min(g.min_dias, dias);
    }
    const diasRegla =
      r.dias_restantes_regla === null || r.dias_restantes_regla === undefined
        ? null
        : Number(r.dias_restantes_regla);
    if (diasRegla !== null && Number.isFinite(diasRegla)) {
      g.min_dias_regla = g.min_dias_regla === null ? diasRegla : Math.min(g.min_dias_regla, diasRegla);
    }
    if (!g.max_dias_vida && Number(r.max_dias_vida || 0) > 0) g.max_dias_vida = Number(r.max_dias_vida || 0);
    if (!g.dias_alerta_antes && Number(r.dias_alerta_antes || 0) > 0) {
      g.dias_alerta_antes = Number(r.dias_alerta_antes || 0);
    }
    g.lotes.push({
      lote: r.lote || "",
      fecha_vencimiento: r.fecha_vencimiento || "",
      dias_para_vencer: dias,
      dias_en_bodega: r.dias_en_bodega === null || r.dias_en_bodega === undefined ? null : Number(r.dias_en_bodega),
      dias_restantes_regla: diasRegla,
      max_dias_vida: Number(r.max_dias_vida || 0),
      dias_alerta_antes: Number(r.dias_alerta_antes || 0),
      stock,
    });
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.nombre_bodega !== b.nombre_bodega) return a.nombre_bodega.localeCompare(b.nombre_bodega);
    return a.nombre_producto.localeCompare(b.nombre_producto);
  });
}

function getHeadFilterValue(id) {
  return ($(id)?.value || "").trim();
}
function parseHeadMultiFilter(id) {
  return getHeadFilterValue(id)
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean);
}

function initRepExistMultiFilters() {
  if (repExistMultiFiltersBound) return;
  const root = $("#view-r-existencias");
  if (!root) return;

  const allMulti = Array.from(root.querySelectorAll(".multiSelect[data-target]"));
  allMulti.forEach((ms) => {
    const target = String(ms.dataset.target || "").trim();
    if (!target) return;
    const hidden = $(target);
    const summary = ms.querySelector(".multiSelectSummary");
    const checks = Array.from(ms.querySelectorAll('input[type="checkbox"]'));
    if (!hidden || !summary || !checks.length) return;

    const placeholder = String(ms.dataset.placeholder || "Todos").trim() || "Todos";

    const syncFromHidden = () => {
      const selected = parseHeadMultiFilter(target);
      checks.forEach((ck) => {
        ck.checked = selected.includes(String(ck.value || ""));
      });
      if (!selected.length) summary.textContent = placeholder;
      else if (selected.length <= 2) summary.textContent = selected.join(", ");
      else summary.textContent = `${selected.length} seleccionados`;
    };

    const applySelection = () => {
      const selected = checks.filter((ck) => ck.checked).map((ck) => String(ck.value || ""));
      hidden.value = selected.join("|");
      syncFromHidden();
      hidden.dispatchEvent(new Event("input", { bubbles: true }));
      hidden.dispatchEvent(new Event("change", { bubbles: true }));
    };

    checks.forEach((ck) => ck.addEventListener("change", applySelection));

    const btnClear = ms.querySelector("[data-ms-clear]");
    if (btnClear) {
      btnClear.addEventListener("click", (e) => {
        e.preventDefault();
        checks.forEach((ck) => (ck.checked = false));
        applySelection();
      });
    }

    const btnAll = ms.querySelector("[data-ms-all]");
    if (btnAll) {
      btnAll.addEventListener("click", (e) => {
        e.preventDefault();
        checks.forEach((ck) => (ck.checked = true));
        applySelection();
      });
    }

    ms.addEventListener("toggle", () => {
      if (!ms.open) return;
      allMulti.forEach((other) => {
        if (other !== ms) other.open = false;
      });
    });

    syncFromHidden();
  });

  repExistMultiFiltersBound = true;
}

function refreshRepExistMultiFilters() {
  const root = $("#view-r-existencias");
  if (!root) return;
  root.querySelectorAll(".multiSelect[data-target]").forEach((ms) => {
    const target = String(ms.dataset.target || "").trim();
    const hidden = target ? $(target) : null;
    const summary = ms.querySelector(".multiSelectSummary");
    const checks = Array.from(ms.querySelectorAll('input[type="checkbox"]'));
    if (!hidden || !summary || !checks.length) return;
    const placeholder = String(ms.dataset.placeholder || "Todos").trim() || "Todos";
    const selected = parseHeadMultiFilter(target);
    checks.forEach((ck) => {
      ck.checked = selected.includes(String(ck.value || ""));
    });
    if (!selected.length) summary.textContent = placeholder;
    else if (selected.length <= 2) summary.textContent = selected.join(", ");
    else summary.textContent = `${selected.length} seleccionados`;
  });
}

function syncRepExistCollapseState(section, expanded) {
  if (!section) return;
  section.classList.toggle("is-collapsed", !expanded);
  const toggle = section.querySelector("[data-rep-collapse-toggle]");
  if (toggle) toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
}

function initReporteExistenciasCollapsibles() {
  const view = $("#view-r-existencias");
  if (!view) return;
  const sections = Array.from(view.querySelectorAll("[data-rep-collapse]"));
  sections.forEach((section) => {
    const expanded = !section.classList.contains("is-collapsed");
    syncRepExistCollapseState(section, expanded);
  });
  if (repExistCollapseBound) return;
  view.addEventListener("click", (e) => {
    const toggle = e.target?.closest ? e.target.closest("[data-rep-collapse-toggle]") : null;
    if (!toggle) return;
    const section = toggle.closest("[data-rep-collapse]");
    if (!section) return;
    const expanded = section.classList.contains("is-collapsed");
    syncRepExistCollapseState(section, expanded);
  });
  repExistCollapseBound = true;
}

function syncProductosCollapseState(section, expanded) {
  if (!section) return;
  section.classList.toggle("is-collapsed", !expanded);
  const toggle = section.querySelector("[data-prd-collapse-toggle]");
  if (toggle) toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
}

function initProductosCollapsibles() {
  const view = $("#view-productos");
  if (!view) return;
  const sections = Array.from(view.querySelectorAll("[data-prd-collapse]"));
  sections.forEach((section) => {
    const expanded = !section.classList.contains("is-collapsed");
    syncProductosCollapseState(section, expanded);
  });
  if (prdCollapseBound) return;
  view.addEventListener("click", (e) => {
    const toggle = e.target?.closest ? e.target.closest("[data-prd-collapse-toggle]") : null;
    if (!toggle) return;
    const section = toggle.closest("[data-prd-collapse]");
    if (!section) return;
    const expanded = section.classList.contains("is-collapsed");
    syncProductosCollapseState(section, expanded);
  });
  prdCollapseBound = true;
}

function syncBodegasCollapseState(section, expanded) {
  if (!section) return;
  section.classList.toggle("is-collapsed", !expanded);
  const toggle = section.querySelector("[data-bod-collapse-toggle]");
  if (toggle) toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
}

function initBodegasCollapsibles() {
  const view = $("#view-bodegas");
  if (!view) return;
  const sections = Array.from(view.querySelectorAll("[data-bod-collapse]"));
  sections.forEach((section) => {
    const expanded = !section.classList.contains("is-collapsed");
    syncBodegasCollapseState(section, expanded);
    const toggle = section.querySelector("[data-bod-collapse-toggle]");
    if (toggle) {
      toggle.onclick = () => {
        const nextExpanded = section.classList.contains("is-collapsed");
        syncBodegasCollapseState(section, nextExpanded);
      };
    }
  });
  if (bodCollapseBound) return;
  view.addEventListener("click", (e) => {
    const toggle = e.target?.closest ? e.target.closest("[data-bod-collapse-toggle]") : null;
    if (!toggle) return;
    const section = toggle.closest("[data-bod-collapse]");
    if (!section) return;
    const expanded = section.classList.contains("is-collapsed");
    syncBodegasCollapseState(section, expanded);
  });
  bodCollapseBound = true;
}
function renderExistenciasGrouped(moveDays) {
  const tb = $("#repExistList");
  if (!tb) return;
  const fBodega = getHeadFilterValue("#repHeadBodega").toLowerCase();
  const fProd = getHeadFilterValue("#repHeadProducto").toLowerCase();
    const fEstado = parseHeadMultiFilter("#repHeadEstado");
  const fRegla = parseHeadMultiFilter("#repHeadRegla");
  const fNivel = parseHeadMultiFilter("#repHeadNivel");
  const fStockMin = Number(getHeadFilterValue("#repHeadStock") || 0);

  const groups = groupExistencias(repExistRowsCache).filter((g) => {
    const estado = existenciaEstadoText(g.min_dias, moveDays);
    const estadoRegla = reglaEstadoText(g.min_dias_regla, g.dias_alerta_antes, g.max_dias_vida);
    const estadoNivel = stockNivelText(g.stock_total, g.minimo_stock, g.maximo_stock);
    if (fBodega && !String(g.nombre_bodega || "").toLowerCase().includes(fBodega)) return false;
    const prodName = String(g.nombre_producto || "").toLowerCase();
    const prodSku = String(g.sku || "").toLowerCase();
    if (fProd && !prodName.includes(fProd) && !prodSku.includes(fProd)) return false;
    if (fEstado.length && !fEstado.includes(estado)) return false;
    if (fRegla.length && !fRegla.includes(estadoRegla)) return false;
    if (fNivel.length && !fNivel.includes(estadoNivel)) return false;
    if (Number.isFinite(fStockMin) && fStockMin > 0 && Number(g.stock_total || 0) < fStockMin) return false;
    return true;
  });

  if (!groups.length) {
    tb.innerHTML = `<tr><td colspan="9">Sin resultados con esos filtros.</td></tr>`;
    return;
  }

  tb.innerHTML = groups
    .map((g) => {
      const expanded = repExistExpanded.has(g.key);
      const lotesHtml = g.lotes
        .sort((a, b) => {
          const ax = a.fecha_vencimiento || "9999-12-31";
          const bx = b.fecha_vencimiento || "9999-12-31";
          return ax.localeCompare(bx);
        })
        .map(
          (lt) => `
          <tr>
            <td>${lt.lote || "-"}</td>
            <td>${fmtDateOnly(lt.fecha_vencimiento) || "-"}</td>
            <td>${lt.dias_para_vencer ?? "-"}</td>
            <td>${reglaBadge(lt.dias_restantes_regla, lt.dias_alerta_antes, lt.max_dias_vida)}</td>
            <td>${lt.stock}</td>
          </tr>
        `
        )
        .join("");
      return `
        <tr>
          <td>${g.nombre_bodega}</td>
          <td>${g.nombre_producto}</td>
          <td>${g.sku || ""}</td>
          <td>${g.stock_total}</td>
          <td>${stockNivelBadge(g.stock_total, g.minimo_stock, g.maximo_stock)}</td>
          <td>${fmtMoney(g.total_dinero)}</td>
          <td>${existenciaBadge(g.min_dias, moveDays)}</td>
          <td>${reglaBadge(g.min_dias_regla, g.dias_alerta_antes, g.max_dias_vida)}</td>
          <td>
            <button class="dispatchBtn dispatchBtn-neutral repExpandBtn" data-expkey="${g.key}">
              ${expanded ? "Ocultar lotes" : "Ver lotes"} (${g.lotes.length})
            </button>
          </td>
        </tr>
        <tr class="repLotRow ${expanded ? "" : "hidden"}" data-lotrow="${g.key}">
          <td colspan="9">
            <div class="tableWrap" style="margin:0">
              <table class="tbl grid" style="min-width:520px">
                <thead>
                  <tr>
                    <th>Lote</th>
                    <th>Fecha vencimiento</th>
                    <th>Dias</th>
                    <th>Tiempo de rotacion</th>
                    <th>Cantidad</th>
                  </tr>
                </thead>
                <tbody>${lotesHtml}</tbody>
              </table>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  tb.querySelectorAll(".repExpandBtn").forEach((btn) => {
    btn.onclick = () => {
      const key = btn.dataset.expkey || "";
      if (!key) return;
      if (repExistExpanded.has(key)) repExistExpanded.delete(key);
      else repExistExpanded.add(key);
      renderExistenciasGrouped(moveDays);
    };
  });
}

function bindReporteHeadFilters() {
  if (repHeadFiltersBound) return;
  const ids = ["#repHeadBodega", "#repHeadProducto", "#repHeadStock", "#repHeadNivel", "#repHeadEstado", "#repHeadRegla"];
  ids.forEach((id) => {
    const el = $(id);
    if (!el) return;
    const onFilter = () => {
      const moveDays = Math.max(1, Number($("#repMoveDays")?.value || 15));
      renderExistenciasGrouped(moveDays);
    };
    el.addEventListener("input", onFilter);
    el.addEventListener("change", onFilter);
  });
  repHeadFiltersBound = true;
}

function scheduleLoadReporteExistencias(delayMs = 260) {
  if (repExistAutoSearchTimer) clearTimeout(repExistAutoSearchTimer);
  repExistAutoSearchTimer = setTimeout(() => {
    loadReporteExistencias();
  }, Math.max(80, Number(delayMs || 260)));
}

async function loadReporteExistencias() {
  await loadExistenciasBodegasFilter();
  const tb = $("#repExistList");
  const alertTb = $("#repAlertList");
  const resume = $("#repAlertResume");
  const repExistResume = $("#repExistResume");
  if (!tb || !alertTb) return;
  if (!repExistCanView) {
    tb.innerHTML = `<tr><td colspan="9">Sin permiso para ver existencias.</td></tr>`;
    alertTb.innerHTML = `<tr><td colspan="8">Sin permiso para ver alertas.</td></tr>`;
    if (resume) resume.textContent = "Sin permiso";
    if (repExistResume) repExistResume.innerHTML = `<span class="pill ghost">Sin permiso</span>`;
    return;
  }

  const q = ($("#repExistQuery")?.value || "").trim();
  if ($("#repHeadProducto") && $("#repHeadProducto").value !== q) $("#repHeadProducto").value = q;
  const warehouse = Number($("#repExistWarehouse")?.value || 0) || "";
  const categoria = Number($("#repExistCategoria")?.value || 0) || "";
  const subcategoria = Number($("#repExistSubcategoria")?.value || 0) || "";
  const from = $("#repDateFrom")?.value || "";
  const to = $("#repDateTo")?.value || "";
  const moveDays = Math.max(1, Number($("#repMoveDays")?.value || 15));
  if ($("#repMoveDays")) $("#repMoveDays").value = String(moveDays);

  const qs = new URLSearchParams({
    q,
    days: String(moveDays),
    limit: "500",
  });
  if (warehouse) qs.set("warehouse", String(warehouse));
  if (categoria) qs.set("categoria", String(categoria));
  if (subcategoria) qs.set("subcategoria", String(subcategoria));
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);

  tb.innerHTML = `<tr><td colspan="9">Cargando...</td></tr>`;
  alertTb.innerHTML = `<tr><td colspan="8">Cargando...</td></tr>`;
  if (resume) resume.textContent = "Cargando...";
  if (repExistResume) repExistResume.innerHTML = `<span class="pill ghost">Cargando...</span>`;

  try {
    const [existR, alertR] = await Promise.all([
      fetch(`/api/reportes/existencias?${qs.toString()}`, {
        headers: { Authorization: "Bearer " + token },
      }),
      fetch(`/api/reportes/existencias/alertas?${qs.toString()}`, {
        headers: { Authorization: "Bearer " + token },
      }),
    ]);
    const existRows = await existR.json().catch(() => []);
    const alertRows = await alertR.json().catch(() => []);

    if (!existR.ok) {
      tb.innerHTML = `<tr><td colspan="9">Error al cargar existencias</td></tr>`;
      if (repExistResume) repExistResume.innerHTML = `<span class="pill ghost">Error</span>`;
    } else if (!existRows.length) {
      repExistRowsCache = [];
      tb.innerHTML = `<tr><td colspan="9">Sin resultados con esos filtros.</td></tr>`;
      if (repExistResume) repExistResume.innerHTML = `<span class="pill ghost">Sin datos</span>`;
    } else {
      repExistRowsCache = existRows;
      repExistExpanded.clear();
      renderExistenciasGrouped(moveDays);
      initRepExistMultiFilters();
      bindReporteHeadFilters();
      const totalCantidad = existRows.reduce((a, x) => a + Number(x.stock || 0), 0);
      const totalDinero = existRows.reduce((a, x) => a + Number(x.total_linea || 0), 0);
      if (repExistResume) {
        repExistResume.innerHTML = `
          <span class="pill">Total cantidad: <strong>${fmtMoney(totalCantidad)}</strong></span>
          <span class="pill">Total dinero: <strong>${fmtMoney(totalDinero)}</strong></span>
        `;
      }
    }

    if (!alertR.ok) {
      alertTb.innerHTML = `<tr><td colspan="8">Error al cargar alertas</td></tr>`;
      if (resume) resume.textContent = "Error";
    } else if (!alertRows.length) {
      alertTb.innerHTML = `<tr><td colspan="8">Sin alertas para esos filtros.</td></tr>`;
      if (resume) resume.textContent = "Sin alertas";
    } else {
      const vencidos = alertRows.filter((x) => Number(x.dias_para_vencer) < 0).length;
      const proximos = alertRows.filter((x) => Number(x.dias_para_vencer) >= 0 && Number(x.dias_para_vencer) <= 7).length;
      const vigentes = alertRows.filter((x) => Number(x.dias_para_vencer) > 7).length;
      if (resume) {
        resume.textContent = `Alertas: ${alertRows.length} (Vencidos: ${vencidos} | Proximos: ${proximos} | Vigentes: ${vigentes})`;
      }
      alertTb.innerHTML = alertRows
        .map(
          (x) => `
          <tr>
            <td>${x.nombre_bodega || ""}</td>
            <td>${x.nombre_producto || ""}</td>
            <td>${x.sku || ""}</td>
            <td>${x.lote || ""}</td>
            <td>${fmtDateOnly(x.fecha_vencimiento)}</td>
            <td>${x.dias_para_vencer ?? ""}</td>
            <td>${x.stock ?? 0}</td>
            <td>${alertIndicadores(x)}</td>
          </tr>
        `
        )
        .join("");
    }
  } catch {
    tb.innerHTML = `<tr><td colspan="9">Error de red</td></tr>`;
    alertTb.innerHTML = `<tr><td colspan="8">Error de red</td></tr>`;
    if (resume) resume.textContent = "Error de red";
    if (repExistResume) repExistResume.innerHTML = `<span class="pill ghost">Error de red</span>`;
  }
}

function fmtQty(v) {
  return Number(v || 0).toLocaleString("en-US", { maximumFractionDigits: 3 });
}

function toQtyInputValue(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return "0";
  return String(n);
}

function getSelectedSalidaConteoWarehouseId() {
  const sel = $("#salCountWarehouse");
  const current = Number(sel?.value || 0);
  if (current > 0) return current;
  if (salCountCanAllBodegas) return 0;
  const first = Number(sel?.options?.[0]?.value || 0);
  return first > 0 ? first : 0;
}

function getWarehouseCountOutFlag(idBodega) {
  const id = Number(idBodega || 0);
  if (!id) return 0;
  return Number(salCountWarehouseConfig.get(id) || 0) ? 1 : 0;
}

function canSaveSalidaConteoForSelectedWarehouse() {
  const idBodega = getSelectedSalidaConteoWarehouseId();
  if (!idBodega) return false;
  return getWarehouseCountOutFlag(idBodega) === 1;
}

function canSaveReporteCorteForSelectedWarehouse() {
  const idBodega = getSelectedReporteCorteWarehouseId();
  if (!idBodega) return false;
  return getWarehouseCountOutFlag(idBodega) === 1;
}

function updateReporteCorteManualHint() {
  const hint = $("#repDiaManualHint");
  if (!hint) return;
  const enabled = canSaveReporteCorteForSelectedWarehouse();
  hint.style.display = enabled ? "" : "none";
  hint.textContent = enabled
    ? "Final manual inicia vacio para que captures el conteo real de cada producto. Luego usa Aplicar conteo para generar solo las salidas necesarias."
    : "";
}
function updateReporteCorteCountAvailability() {
  const btn = $("#repDiaApplyCount");
  if (!btn) return;
  const enabled = canSaveReporteCorteForSelectedWarehouse();
  btn.disabled = !enabled || repDiaApplyInFlight;
  btn.style.display = enabled ? "" : "none";
  btn.title = enabled ? "" : "Esta bodega no tiene habilitada la salida por conteo final.";
  updateReporteCorteManualHint();
}

function updateReporteCorteManualColumnVisibility() {
  const th = $("#repDiaFinalCol");
  if (!th) return;
  th.style.display = canSaveReporteCorteForSelectedWarehouse() ? "" : "none";
  updateReporteCorteManualHint();
}

function setPersistentFieldError(el, active) {
  if (!el) return;
  el.classList.toggle("field-error-persist", !!active);
  if (!active) el.classList.remove("field-error");
}

function clearReporteCorteValidationMessage() {
  const box = $("#repDiaValidation");
  if (!box) return;
  box.style.display = "none";
  box.textContent = "";
}

function setReporteCorteValidationMessage(text) {
  const box = $("#repDiaValidation");
  if (!box) return;
  const safe = String(text || "").trim();
  box.textContent = safe;
  box.style.display = safe ? "" : "none";
}

function getReporteCorteFinalIssues() {
  return repDiaRowsCache
    .map((row) => {
      const input = document.querySelector(`[data-rep-dia-final="${Number(row.id_producto || 0)}"]`);
      if (!input) return null;
      const raw = String(input.value ?? "").trim();
      const val = Number(raw);
      const stockActual = Number(row.existencia_actual || 0);
      let reason = "";
      if (!raw) reason = "sin dato";
      else if (!Number.isFinite(val)) reason = "valor invalido";
      else if (val < 0) reason = "no puede ser negativo";
      else if (val > stockActual) reason = `supera stock actual (${fmtQty(stockActual)})`;
      return reason
        ? {
            row,
            input,
            reason,
            label: String(row.nombre_producto || row.sku || `Producto ${row.id_producto || ""}`).trim(),
          }
        : null;
    })
    .filter(Boolean);
}

function updateReporteCorteFinalValidationUi({ focusFirst = false, showSummary = false } = {}) {
  const issues = getReporteCorteFinalIssues();
  repDiaRowsCache.forEach((row) => {
    const input = document.querySelector(`[data-rep-dia-final="${Number(row.id_producto || 0)}"]`);
    const hasIssue = issues.some((issue) => Number(issue.row.id_producto || 0) === Number(row.id_producto || 0));
    setPersistentFieldError(input, hasIssue);
  });
  if (!issues.length) {
    clearReporteCorteValidationMessage();
    return issues;
  }
  if (showSummary) {
    const detail = issues.map((issue) => `${issue.label}: ${issue.reason}`).join(" | ");
    setReporteCorteValidationMessage(`Corrige Final manual en: ${detail}`);
  }
  if (focusFirst && issues[0]?.input) issues[0].input.focus();
  return issues;
}

function bindReporteCorteFinalInputs() {
  document.querySelectorAll("[data-rep-dia-final]").forEach((input) => {
    input.addEventListener("input", () => {
      updateReporteCorteFinalValidationUi({ showSummary: true });
    });
  });
}

function updateSalidaConteoManualColumnVisibility() {
  const finalTh = $("#salCountFinalCol");
  const outTh = $("#salCountOutCol");
  const enabled = canSaveSalidaConteoForSelectedWarehouse();
  if (finalTh) finalTh.style.display = enabled ? "" : "none";
  if (outTh) outTh.style.display = enabled ? "" : "none";
}

function updateSalidaConteoPanelVisibility() {
  const panel = $("#salCountPanel");
  if (!panel) return;
  panel.style.display = canSaveSalidaConteoForSelectedWarehouse() ? "" : "none";
}

function updateSalidaConteoAvailability() {
  const btn = $("#salCountSave");
  const hint = $("#salCountHint");
  const enabled = canSaveSalidaConteoForSelectedWarehouse();
  updateSalidaConteoPanelVisibility();
  if (btn) {
    btn.disabled = !enabled || salCountApplyInFlight;
    btn.title = enabled
      ? ""
      : "Esta bodega no tiene habilitada la salida por conteo final. El corte se puede consultar igual.";
  }
  if (hint) {
    hint.textContent = enabled
      ? "Captura la existencia final real y luego guarda."
      : "Esta bodega solo consulta el corte. La salida por conteo final esta deshabilitada.";
  }
}

async function loadSalidaConteoWarehouseFilter(force = false) {
  const sel = $("#salCountWarehouse");
  if (!sel) return;
  if (salCountWarehouseLoaded && !force) return;
  try {
    const r = await fetch("/api/reportes/stock-scope", {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return;
    const rows = Array.isArray(j.bodegas) ? j.bodegas : [];
    salCountCanAllBodegas = Number(j.can_all_bodegas) === 1 || j.can_all_bodegas === true;
    if (salCountCanAllBodegas) {
      sel.innerHTML =
        `<option value="">Todas las bodegas</option>` +
        rows.map((b) => `<option value="${b.id_bodega}">${escapeHtml(b.nombre_bodega || "")}</option>`).join("");
      sel.disabled = false;
      if (Number(j.id_bodega_default || 0) > 0) sel.value = String(j.id_bodega_default);
    } else {
      sel.innerHTML = rows.map((b) => `<option value="${b.id_bodega}">${escapeHtml(b.nombre_bodega || "")}</option>`).join("");
      if (Number(j.id_bodega_default || 0) > 0) sel.value = String(j.id_bodega_default);
      sel.disabled = true;
    }
    const cfgRes = await fetch("/api/bodegas?all=1", {
      headers: { Authorization: "Bearer " + token },
    });
    const cfgRows = await cfgRes.json().catch(() => []);
    if (cfgRes.ok) {
      salCountWarehouseConfig = new Map(
        (Array.isArray(cfgRows) ? cfgRows : []).map((b) => [
          Number(b.id_bodega || 0),
          Number(b.permite_salida_conteo_final || 0) ? 1 : 0,
        ])
      );
    }
    salCountWarehouseLoaded = true;
    updateSalidaConteoAvailability();
    updateSalidaConteoManualColumnVisibility();
    updateReporteCorteCountAvailability();
    updateReporteCorteManualColumnVisibility();
  } catch (e) { console.error('api_subcategorias:', e); }
}

function updateSalidaConteoSummary() {
  const resume = $("#salCountResume");
  if (!resume) return;
  if (!salCountRowsCache.length) {
    resume.innerHTML = `<span class="pill ghost">Sin datos</span>`;
    return;
  }
  let totalActual = 0;
  let totalFinal = 0;
  let totalSalida = 0;
  let productosConSalida = 0;
  salCountRowsCache.forEach((row) => {
    const actual = Number(row.existencia_actual || 0);
    const input = document.querySelector(`[data-sal-count-final="${Number(row.id_producto || 0)}"]`);
    const raw = String(input?.value ?? "").trim();
    const finalVal = raw ? Number(raw) : actual;
    const finalSafe = Number.isFinite(finalVal) && finalVal >= 0 ? finalVal : 0;
    const salida = Math.max(0, actual - finalSafe);
    totalActual += actual;
    totalFinal += finalSafe;
    totalSalida += salida;
    if (salida > 0) productosConSalida += 1;
    const outCell = document.querySelector(`[data-sal-count-out="${Number(row.id_producto || 0)}"]`);
    if (outCell) outCell.textContent = fmtQty(salida);
  });
  resume.innerHTML = `
    <span class="pill ghost">Productos: <strong>${salCountRowsCache.length}</strong></span>
    <span class="pill ghost">Existencia actual: <strong>${fmtQty(totalActual)}</strong></span>
    <span class="pill ghost">Existencia final: <strong>${fmtQty(totalFinal)}</strong></span>
    <span class="pill ghost">Productos con salida: <strong>${productosConSalida}</strong></span>
    <span class="pill ghost">Salida calculada: <strong>${fmtQty(totalSalida)}</strong></span>
    <span class="pill ghost">${canSaveSalidaConteoForSelectedWarehouse() ? "Guardado habilitado" : "Solo consulta"}</span>
  `;
}

async function loadSalidaConteoFinal() {
  await loadSalidaConteoWarehouseFilter();
  updateSalidaConteoAvailability();
  updateSalidaConteoManualColumnVisibility();
  if (!canSaveSalidaConteoForSelectedWarehouse()) {
    salCountRowsCache = [];
    return;
  }
  const tb = $("#salCountList");
  if (!tb) return;
  const q = ($("#salCountQuery")?.value || "").trim();
  const showAll = $("#salCountShowAll")?.checked ? "1" : "0";
  const idBodega = Number($("#salCountWarehouse")?.value || 0);
  const canManual = canSaveSalidaConteoForSelectedWarehouse();
  const qs = new URLSearchParams({ q, show_all: showAll, limit: "1500" });
  if (idBodega > 0) qs.set("warehouse", String(idBodega));
  salCountRowsCache = [];
  tb.innerHTML = `<tr><td colspan="${canManual ? 8 : 6}">Cargando...</td></tr>`;
  try {
    const r = await fetch(`/api/reportes/corte-diario?${qs.toString()}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      tb.innerHTML = `<tr><td colspan="${canManual ? 8 : 6}">Error al cargar datos.</td></tr>`;
      if ($("#salCountMeta")) $("#salCountMeta").textContent = "Error";
      updateSalidaConteoSummary();
      return;
    }

    const rows = Array.isArray(j.rows) ? j.rows : [];
    salCountRowsCache = rows;
    if ($("#salCountMeta")) {
      $("#salCountMeta").textContent = `${j.bodega || "Bodega"} | Ayer: ${fmtDateOnly(j.fecha_ayer)} | Hoy: ${fmtDateOnly(j.fecha_hoy)}`;
    }
    if (!rows.length) {
      tb.innerHTML = `<tr><td colspan="${canManual ? 8 : 6}">Sin datos para mostrar.</td></tr>`;
      updateSalidaConteoSummary();
      return;
    }

    tb.innerHTML = rows
      .map(
        (x) => `
        <tr>
          <td>${x.nombre_producto || ""}</td>
          <td>${x.sku || ""}</td>
          <td>${fmtQty(x.existencia_ayer)}</td>
          <td>${fmtQty(x.entradas_hoy)}</td>
          <td>${fmtQty(x.salidas_hoy)}</td>
          <td>${fmtQty(x.existencia_actual)}</td>
          ${
            canManual
              ? `<td>
            <input
              class="in"
              data-sal-count-final="${Number(x.id_producto || 0)}"
              type="number"
              min="0"
              step="0.001"
              value="${toQtyInputValue(x.existencia_actual)}"
            />
          </td>
          <td data-sal-count-out="${Number(x.id_producto || 0)}">${fmtQty(0)}</td>`
              : ""
          }
        </tr>
      `
      )
      .join("");
    updateSalidaConteoSummary();
    updateSalidaConteoAvailability();
  } catch {
    salCountRowsCache = [];
    tb.innerHTML = `<tr><td colspan="${canManual ? 8 : 6}">Error de red.</td></tr>`;
    if ($("#salCountMeta")) $("#salCountMeta").textContent = "Error de red";
    updateSalidaConteoSummary();
    updateSalidaConteoAvailability();
  }
}

async function guardarSalidaConteoFinalDesdeSalidas() {
  if (salCountApplyInFlight) return;
  if (!canSaveSalidaConteoForSelectedWarehouse()) {
    showEntToast("Esta bodega no tiene habilitada la salida por conteo final. El corte sigue disponible solo para consulta.", "bad");
    return;
  }
  if (!salCountRowsCache.length) {
    showEntToast("Primero carga los productos para conteo final.", "bad");
    return;
  }

  const idBodega = getSelectedSalidaConteoWarehouseId();
  if (!idBodega) {
    showEntToast("Selecciona una bodega especifica para generar las salidas.", "bad");
    markError($("#salCountWarehouse"));
    return;
  }

  const invalidInput = salCountRowsCache.find((row) => {
    const input = document.querySelector(`[data-sal-count-final="${Number(row.id_producto || 0)}"]`);
    const raw = String(input?.value ?? "").trim();
    const val = Number(raw);
    return !raw || !Number.isFinite(val) || val < 0 || val > Number(row.existencia_actual || 0);
  });
  if (invalidInput) {
    const badInput = document.querySelector(`[data-sal-count-final="${Number(invalidInput.id_producto || 0)}"]`);
    if (badInput) markError(badInput);
    showEntToast("Revisa las existencias finales: no pueden ser negativas ni mayores al stock actual.", "bad");
    return;
  }

  const lines = salCountRowsCache
    .map((row) => {
      const input = document.querySelector(`[data-sal-count-final="${Number(row.id_producto || 0)}"]`);
      const existenciaFinal = Number(input?.value || 0);
      const existenciaActual = Number(row.existencia_actual || 0);
      const diferencia = existenciaActual - existenciaFinal;
      if (diferencia <= 0) return null;
      return {
        id_producto: Number(row.id_producto || 0),
        existencia_final: existenciaFinal,
        observacion_linea: `Conteo final de ${row.nombre_producto || "producto"}`,
      };
    })
    .filter(Boolean);

  if (!lines.length) {
    showEntToast("No hay diferencias para generar salidas.", "bad");
    return;
  }

  const totalSalida = lines.reduce((acc, ln) => {
    const row = salCountRowsCache.find((x) => Number(x.id_producto || 0) === Number(ln.id_producto || 0));
    if (!row) return acc;
    return acc + (Number(row.existencia_actual || 0) - Number(ln.existencia_final || 0));
  }, 0);

  const ok = await uiConfirm(
    `Se generaran salidas para ${lines.length} productos por un total de ${fmtQty(totalSalida)} unidades. Deseas continuar?`,
    "Confirmar salidas por conteo"
  );
  if (!ok) return;

  salCountApplyInFlight = true;
  const btn = $("#salCountSave");
  if (btn) btn.disabled = true;
  showSavingProgressToast("salidas por conteo");
  try {
    let payload = {
      id_bodega: idBodega,
      observaciones: "Salida automatica por conteo final",
      lines,
    };
    let r = await fetch("/api/salidas/conteo-final", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(payload),
    });
    let j = await r.json().catch(() => ({}));
    if (!r.ok && (j.code === "SENSITIVE_APPROVAL_REQUIRED" || j.code === "SUPERVISOR_PIN_REQUIRED")) {
      const ap = await promptSensitiveApproval("salida por conteo final");
      if (!ap) {
        showEntToast("Operacion cancelada: falta validacion de supervisor.", "bad");
        return;
      }
      payload = { ...payload, ...ap };
      r = await fetch("/api/salidas/conteo-final", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(payload),
      });
      j = await r.json().catch(() => ({}));
    }
    if (!r.ok) {
      showEntToast(j.error || "No se pudieron generar las salidas por conteo.", "bad");
      return;
    }
    showSupervisorAuthBadge(j.sensitive_approval);
    showEntToast(
      `Salidas generadas #${j.id_movimiento} para ${Number(j.total_productos || 0)} productos.`,
      "ok"
    );
    await loadSalidaConteoFinal();
  } catch {
    showEntToast("Error de red al generar salidas por conteo.", "bad");
  } finally {
    salCountApplyInFlight = false;
    updateSalidaConteoAvailability();
  }
}

function getSelectedReporteCorteWarehouseId() {
  const sel = $("#repDiaWarehouse");
  const current = Number(sel?.value || 0);
  if (current > 0) return current;
  if (repDiaCanAllBodegas) return 0;
  const first = Number(sel?.options?.[0]?.value || 0);
  return first > 0 ? first : 0;
}

async function loadReporteCorteWarehouseFilter(force = false) {
  const sel = $("#repDiaWarehouse");
  if (!sel) return;
  if (repDiaWarehouseLoaded && !force) return;
  try {
    const r = await fetch("/api/reportes/stock-scope", {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return;
    const rows = Array.isArray(j.bodegas) ? j.bodegas : [];
    repDiaCanAllBodegas = Number(j.can_all_bodegas) === 1 || j.can_all_bodegas === true;
    if (repDiaCanAllBodegas) {
      sel.innerHTML =
        `<option value="">Todas las bodegas</option>` +
        rows.map((b) => `<option value="${b.id_bodega}">${escapeHtml(b.nombre_bodega || "")}</option>`).join("");
      sel.disabled = false;
      if (Number(j.id_bodega_default || 0) > 0) sel.value = String(j.id_bodega_default);
    } else {
      sel.innerHTML = rows.map((b) => `<option value="${b.id_bodega}">${escapeHtml(b.nombre_bodega || "")}</option>`).join("");
      if (Number(j.id_bodega_default || 0) > 0) sel.value = String(j.id_bodega_default);
      sel.disabled = true;
    }
    if (!salCountWarehouseConfig.size || force) {
      const cfgRes = await fetch("/api/bodegas?all=1", {
        headers: { Authorization: "Bearer " + token },
      });
      const cfgRows = await cfgRes.json().catch(() => []);
      if (cfgRes.ok) {
        salCountWarehouseConfig = new Map(
          (Array.isArray(cfgRows) ? cfgRows : []).map((b) => [
            Number(b.id_bodega || 0),
            Number(b.permite_salida_conteo_final || 0) ? 1 : 0,
          ])
        );
      }
    }
    repDiaWarehouseLoaded = true;
    updateReporteCorteCountAvailability();
    updateReporteCorteManualColumnVisibility();
  } catch (e) { console.error('updateReporteCorteManual:', e); }
}

async function loadReporteCorteDiario() {
  await loadReporteCorteWarehouseFilter();
  await loadCloseDayAccessFlag();
  updateReporteCorteCountAvailability();
  updateReporteCorteManualColumnVisibility();
  const tb = $("#repDiaList");
  if (!tb) return;
  const q = ($("#repDiaQuery")?.value || "").trim();
  const showAll = $("#repDiaShowAll")?.checked ? "1" : "0";
  const idBodega = Number($("#repDiaWarehouse")?.value || 0);
  const canManual = canSaveReporteCorteForSelectedWarehouse();
  const qs = new URLSearchParams({ q, show_all: showAll, limit: "1500" });
  if (idBodega > 0) qs.set("warehouse", String(idBodega));
  repDiaRowsCache = [];
  tb.innerHTML = `<tr><td colspan="${canManual ? 7 : 6}">Cargando...</td></tr>`;
  try {
    const r = await fetch(`/api/reportes/corte-diario?${qs.toString()}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      tb.innerHTML = `<tr><td colspan="${canManual ? 7 : 6}">Error al cargar reporte.</td></tr>`;
      if ($("#repDiaMeta")) $("#repDiaMeta").textContent = "Error";
      if ($("#repDiaResume")) $("#repDiaResume").innerHTML = `<span class="pill ghost">Error</span>`;
      return;
    }

    const rows = Array.isArray(j.rows) ? j.rows : [];
    repDiaRowsCache = rows;
    if ($("#repDiaMeta")) {
      $("#repDiaMeta").textContent = `${j.bodega || "Bodega"} | Ayer: ${fmtDateOnly(j.fecha_ayer)} | Hoy: ${fmtDateOnly(j.fecha_hoy)}`;
    }
    if (!rows.length) {
      tb.innerHTML = `<tr><td colspan="${canManual ? 7 : 6}">Sin datos para mostrar.</td></tr>`;
      if ($("#repDiaResume")) $("#repDiaResume").innerHTML = `<span class="pill ghost">Sin datos</span>`;
      clearReporteCorteValidationMessage();
      updateReporteCorteCountAvailability();
      return;
    }

    const totalAyer = rows.reduce((a, x) => a + Number(x.existencia_ayer || 0), 0);
    const totalEntradas = rows.reduce((a, x) => a + Number(x.entradas_hoy || 0), 0);
    const totalSalidas = rows.reduce((a, x) => a + Number(x.salidas_hoy || 0), 0);
    const totalActual = rows.reduce((a, x) => a + Number(x.existencia_actual || 0), 0);
    if ($("#repDiaResume")) {
      $("#repDiaResume").innerHTML = `
        <span class="pill ghost">Productos: <strong>${rows.length}</strong></span>
        <span class="pill ghost">Existencia ayer: <strong>${fmtQty(totalAyer)}</strong></span>
        <span class="pill ghost">Entradas hoy: <strong>${fmtQty(totalEntradas)}</strong></span>
        <span class="pill ghost">Salidas hoy: <strong>${fmtQty(totalSalidas)}</strong></span>
        <span class="pill ghost">Existencia actual: <strong>${fmtQty(totalActual)}</strong></span>
      `;
    }
    updateReporteCorteCountAvailability();

    tb.innerHTML = rows
      .map(
        (x) => `
        <tr>
          <td>${x.nombre_producto || ""}</td>
          <td>${x.sku || ""}</td>
          <td>${fmtQty(x.existencia_ayer)}</td>
          <td>${fmtQty(x.entradas_hoy)}</td>
          <td>${fmtQty(x.salidas_hoy)}</td>
          <td>${fmtQty(x.existencia_actual)}</td>
          ${
            canManual
              ? `<td>
            <input
              class="in"
              data-rep-dia-final="${Number(x.id_producto || 0)}"
              type="number"
              min="0"
              step="0.001"
              value=""
              placeholder="Ingresa final real"
            />
          </td>`
              : ""
          }
        </tr>
      `
      )
      .join("");
    clearReporteCorteValidationMessage();
    if (canManual) bindReporteCorteFinalInputs();
  } catch {
    repDiaRowsCache = [];
    tb.innerHTML = `<tr><td colspan="${canManual ? 7 : 6}">Error de red.</td></tr>`;
    if ($("#repDiaMeta")) $("#repDiaMeta").textContent = "Error de red";
    if ($("#repDiaResume")) $("#repDiaResume").innerHTML = `<span class="pill ghost">Error de red</span>`;
    clearReporteCorteValidationMessage();
    updateReporteCorteCountAvailability();
    updateReporteCorteManualColumnVisibility();
  }
}

async function guardarSalidasPorConteoFinal() {
  if (repDiaApplyInFlight) return;
  if (!canSaveReporteCorteForSelectedWarehouse()) {
    showEntToast("Esta bodega no tiene habilitada la salida por conteo final.", "bad");
    updateReporteCorteCountAvailability();
    return;
  }
  if (!repDiaRowsCache.length) {
    showEntToast("Primero carga el reporte de corte diario.", "bad");
    return;
  }

  const idBodega = getSelectedReporteCorteWarehouseId();
  if (!idBodega) {
    showEntToast("Selecciona una bodega especifica para generar las salidas.", "bad");
    markError($("#repDiaWarehouse"));
    return;
  }

  const issues = updateReporteCorteFinalValidationUi({ focusFirst: true, showSummary: true });
  if (issues.length) {
    issues.forEach((issue) => markError(issue.input));
    showEntToast("Corrige los productos marcados en rojo. Final manual no puede quedar vacio, ser negativo ni mayor al stock actual.", "bad");
    return;
  }

  const lines = repDiaRowsCache
    .map((row) => {
      const input = document.querySelector(`[data-rep-dia-final="${Number(row.id_producto || 0)}"]`);
      const existenciaFinal = Number(input?.value || 0);
      const existenciaActual = Number(row.existencia_actual || 0);
      const diferencia = existenciaActual - existenciaFinal;
      if (diferencia <= 0) return null;
      return {
        id_producto: Number(row.id_producto || 0),
        existencia_final: existenciaFinal,
        observacion_linea: `Conteo final de ${row.nombre_producto || "producto"}`,
      };
    })
    .filter(Boolean);

  if (!lines.length) {
    showEntToast("No hay diferencias para generar salidas.", "bad");
    return;
  }

  const totalSalida = lines.reduce((acc, ln) => {
    const row = repDiaRowsCache.find((x) => Number(x.id_producto || 0) === Number(ln.id_producto || 0));
    if (!row) return acc;
    return acc + (Number(row.existencia_actual || 0) - Number(ln.existencia_final || 0));
  }, 0);

  const ok = await uiConfirm(
    `Se generaran salidas para ${lines.length} productos por un total de ${fmtQty(totalSalida)} unidades. Deseas continuar?`,
    "Confirmar salidas por conteo"
  );
  if (!ok) return;

  repDiaApplyInFlight = true;
  const btn = $("#repDiaApplyCount");
  if (btn) btn.disabled = true;
  showSavingProgressToast("salidas por conteo");
  try {
    let payload = {
      id_bodega: idBodega,
      observaciones: "Salida automatica por conteo final",
      lines,
    };
    let r = await fetch("/api/salidas/conteo-final", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(payload),
    });
    let j = await r.json().catch(() => ({}));
    if (!r.ok && (j.code === "SENSITIVE_APPROVAL_REQUIRED" || j.code === "SUPERVISOR_PIN_REQUIRED")) {
      const ap = await promptSensitiveApproval("salida por conteo final");
      if (!ap) {
        showEntToast("Operacion cancelada: falta validacion de supervisor.", "bad");
        return;
      }
      payload = { ...payload, ...ap };
      r = await fetch("/api/salidas/conteo-final", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(payload),
      });
      j = await r.json().catch(() => ({}));
    }
    if (!r.ok) {
      showEntToast(j.error || "No se pudieron generar las salidas por conteo.", "bad");
      return;
    }
    showSupervisorAuthBadge(j.sensitive_approval);
    showEntToast(
      `Salidas generadas #${j.id_movimiento} para ${Number(j.total_productos || 0)} productos.`,
      "ok"
    );
    await loadReporteCorteDiario();
  } catch {
    showEntToast("Error de red al generar salidas por conteo.", "bad");
  } finally {
    repDiaApplyInFlight = false;
    updateReporteCorteCountAvailability();
  }
}

function showSupervisorAuthBadge(info) {
  if (!info) return;
  const m = String(info.approved_by_method || "");
  if (!["SUPERVISOR_PIN", "SUPERVISOR_SELF_PIN"].includes(m)) return;
  const badge = $("#supervisorAuthBadge");
  if (!badge) return;
  const name = String(info.approved_by_name || "").trim() || "Supervisor";
  const user = String(info.approved_by_user || "").trim();
  badge.textContent = `Supervisor autorizado: ${name}${user ? ` (${user})` : ""}`;
  badge.classList.remove("hidden");
  clearTimeout(badge._timer);
  badge._timer = setTimeout(() => badge.classList.add("hidden"), 15000);
}

async function promptSensitiveApproval(actionLabel = "accion sensible") {
  return uiSupervisorApproval(actionLabel);
}

async function realizarCierreDiaManual() {
  if (repCloseDayInFlight) return;
  repCloseDayInFlight = true;
  const closeBtn = $("#repDiaClose");
  if (closeBtn) closeBtn.classList.add("is-loading");
  try {
    await loadCloseDayAccessFlag();
    if (!repCanCloseDay) {
      showEntToast("Solo el rol bodeguero puede realizar el cierre del dia.", "bad");
      return;
    }
    const stRes = await fetch("/api/cierre-dia/estado", {
      headers: { Authorization: "Bearer " + token },
    });
    const st = await stRes.json().catch(() => ({}));
    if (!stRes.ok) {
      showEntToast(st.error || "No se pudo consultar el estado del cierre diario.", "bad");
      return;
    }

    const fechaObjetivo = st.pending_yesterday_close ? st.ayer : st.hoy;
    if (!fechaObjetivo) {
      showEntToast("No se pudo determinar la fecha a cerrar.", "bad");
      return;
    }

    const ok = await uiConfirm(
      `Estas seguro de realizar el cierre del dia ${fechaObjetivo}?\n\n⚠ Este proceso es IRREVERSIBLE. No podra deshacerse ni revertirse.`,
      "Confirmar cierre de dia"
    );
    if (!ok) {
      return;
    }

    let payload = { fecha: fechaObjetivo, confirmar: true };
    let r = await fetch("/api/cierre-dia", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    let j = await r.json().catch(() => ({}));
    if (!r.ok && (j.code === "SUPERVISOR_PIN_REQUIRED" || j.code === "SENSITIVE_APPROVAL_REQUIRED")) {
      const ap = await uiCloseDaySupervisorPin();
      if (!ap) {
        showEntToast("Cierre cancelado: falta validacion de supervisor.", "bad");
        return;
      }
      payload = { ...payload, ...ap };
      r = await fetch("/api/cierre-dia", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      j = await r.json().catch(() => ({}));
    }
    if (!r.ok) {
      showEntToast(j.error || "No se pudo realizar el cierre diario.", "bad");
      return;
    }

    showSupervisorAuthBadge(j.sensitive_approval);
    showEntToast(`Cierre de dia realizado para la fecha ${j.fecha_cierre}.`, "ok");
    loadReporteCorteDiario();
  } catch {
    showEntToast("Error de red al intentar realizar el cierre diario.", "bad");
  } finally {
    repCloseDayInFlight = false;
    if (closeBtn) closeBtn.classList.remove("is-loading");
  }
}

async function loadCloseHistoryWarehouseFilter() {
  const sel = $("#repCloseWarehouse");
  if (!sel || repCloseWarehouseLoaded) return;
  try {
    const r = await fetch("/api/reportes/stock-scope", {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return;
    const rows = Array.isArray(j.bodegas) ? j.bodegas : [];
    repCanCloseDay = Number(j.can_close_day) === 1 || j.can_close_day === true;
    repClosePrivilegeLoaded = true;
    applyCloseDayVisibility();
    repCloseCanAllBodegas = Number(j.can_all_bodegas) === 1 || j.can_all_bodegas === true;
    if (repCloseCanAllBodegas) {
      sel.innerHTML =
        `<option value="">Todas las bodegas</option>` +
        rows.map((b) => `<option value="${b.id_bodega}">${escapeHtml(b.nombre_bodega || "")}</option>`).join("");
      sel.disabled = false;
    } else {
      sel.innerHTML = rows.map((b) => `<option value="${b.id_bodega}">${escapeHtml(b.nombre_bodega || "")}</option>`).join("");
      if (Number(j.id_bodega_default || 0)) sel.value = String(j.id_bodega_default);
      sel.disabled = true;
    }
    repCloseWarehouseLoaded = true;
  } catch {
    repCanCloseDay = false;
    repClosePrivilegeLoaded = false;
    applyCloseDayVisibility();
  }
}

function applyCloseDayVisibility() {
  const btn = $("#repDiaClose");
  if (!btn) return;
  btn.style.display = repCanCloseDay ? "" : "none";
  btn.disabled = !repCanCloseDay || !hasPerm("action.create_update");
}

async function loadCloseDayAccessFlag(force = false) {
  if (repClosePrivilegeLoaded && !force) {
    applyCloseDayVisibility();
    return;
  }
  try {
    const r = await fetch("/api/reportes/stock-scope", {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      repCanCloseDay = false;
      return;
    }
    repCanCloseDay = Number(j.can_close_day) === 1 || j.can_close_day === true;
    repClosePrivilegeLoaded = true;
  } catch {
    repCanCloseDay = false;
  } finally {
    applyCloseDayVisibility();
  }
}

async function loadCloseHistoryList(mode = "all") {
  const tb = $("#repCloseHistoryList");
  const resume = $("#repCloseResume");
  if (!tb) return;
  tb.innerHTML = `<tr><td colspan="9">Cargando...</td></tr>`;

  const qs = new URLSearchParams({ limit: "365" });
  const fecha = $("#repCloseSearchDate")?.value || "";
  const idBodega = Number($("#repCloseWarehouse")?.value || 0);
  if (mode === "date" && fecha) qs.set("fecha", fecha);
  if (idBodega > 0) qs.set("warehouse", String(idBodega));

  try {
    const r = await fetch(`/api/cierre-dia?${qs.toString()}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      tb.innerHTML = `<tr><td colspan="9">Error cargando historial.</td></tr>`;
      if (resume) resume.innerHTML = `<span class="pill ghost">Error</span>`;
      return;
    }

    const rows = Array.isArray(j.rows) ? j.rows : [];
    if (!rows.length) {
      tb.innerHTML = `<tr><td colspan="9">Sin cierres para ese filtro.</td></tr>`;
      if (resume) resume.innerHTML = `<span class="pill ghost">Sin resultados</span>`;
      if ($("#repCloseDetailList")) $("#repCloseDetailList").innerHTML = `<tr><td colspan="6">Sin detalle</td></tr>`;
      if ($("#repCloseDetailMeta")) $("#repCloseDetailMeta").textContent = "Sin detalle";
      repCloseSelectedDate = "";
      repCloseSelectedWarehouseId = 0;
      repCloseSelectedSummary = null;
      return;
    }

    const totalEntradas = rows.reduce((a, x) => a + Number(x.total_entradas || 0), 0);
    const totalSalidas = rows.reduce((a, x) => a + Number(x.total_salidas || 0), 0);
    if (resume) {
      resume.innerHTML = `
        <span class="pill ghost">Cierres: <strong>${rows.length}</strong></span>
        <span class="pill ghost">Entradas: <strong>${fmtQty(totalEntradas)}</strong></span>
        <span class="pill ghost">Salidas: <strong>${fmtQty(totalSalidas)}</strong></span>
      `;
    }

    tb.innerHTML = rows
      .map((x) => {
        const fechaYmd = toYmd(x.fecha_cierre);
        const bod = Number(x.id_bodega || 0);
        return `
        <tr>
          <td>${fmtDateOnly(x.fecha_cierre)}</td>
          <td>${escapeHtml(x.nombre_bodega || (x.id_bodega ? `#${x.id_bodega}` : "-"))}</td>
          <td>${fmtQty(x.total_entradas)}</td>
          <td>${fmtQty(x.total_salidas)}</td>
          <td>${fmtQty(x.total_existencia_cierre)}</td>
          <td>${Number(x.total_lineas || 0)}</td>
          <td>${x.creado_por_nombre || (x.creado_por ? `#${x.creado_por}` : "-")}</td>
          <td>${fmtDateTime(x.creado_en)}</td>
          <td><button class="btn soft btn-sm" data-close-detail="${fechaYmd}" data-close-bodega="${bod}">Ver detalle</button></td>
        </tr>
      `;
      })
      .join("");

    tb.querySelectorAll("[data-close-detail]").forEach((btn) => {
      btn.onclick = () => loadCloseDayDetail(btn.dataset.closeDetail || "", Number(btn.dataset.closeBodega || 0));
    });

    const firstDate = toYmd(rows[0]?.fecha_cierre || "");
    const firstBodega = Number(rows[0]?.id_bodega || 0);
    if (firstDate) await loadCloseDayDetail(firstDate, firstBodega);
  } catch {
    tb.innerHTML = `<tr><td colspan="9">Error de red.</td></tr>`;
    if (resume) resume.innerHTML = `<span class="pill ghost">Error de red</span>`;
    repCloseSelectedDate = "";
    repCloseSelectedWarehouseId = 0;
    repCloseSelectedSummary = null;
  }
}

async function loadCloseDayDetail(fecha, idBodega = 0) {
  const detailTb = $("#repCloseDetailList");
  const meta = $("#repCloseDetailMeta");
  if (!detailTb || !fecha) return;
  detailTb.innerHTML = `<tr><td colspan="6">Cargando detalle...</td></tr>`;
  if (meta) meta.textContent = `Cargando ${fmtDateOnly(fecha)}...`;

  try {
    const qs = new URLSearchParams();
    if (Number(idBodega || 0) > 0) qs.set("warehouse", String(Number(idBodega || 0)));
    const url = `/api/cierre-dia/${encodeURIComponent(fecha)}${qs.toString() ? `?${qs.toString()}` : ""}`;
    const r = await fetch(url, {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      detailTb.innerHTML = `<tr><td colspan="6">No se pudo cargar el detalle.</td></tr>`;
      if (meta) meta.textContent = "Error cargando detalle";
      repCloseSelectedDate = "";
      repCloseSelectedWarehouseId = 0;
      repCloseSelectedSummary = null;
      return;
    }

    const rows = Array.isArray(j.rows) ? j.rows : [];
    const c = j.cierre || {};
    repCloseSelectedDate = toYmd(c.fecha_cierre || fecha);
    repCloseSelectedWarehouseId = Number(c.id_bodega || idBodega || 0);
    repCloseSelectedSummary = c;
    if (meta) {
      meta.textContent =
        `Bodega: ${c.nombre_bodega || (c.id_bodega ? `#${c.id_bodega}` : "-")} | ` +
        `Fecha ${fmtDateOnly(c.fecha_cierre)} | Entradas: ${fmtQty(c.total_entradas)} | ` +
        `Salidas: ${fmtQty(c.total_salidas)} | Existencia: ${fmtQty(c.total_existencia_cierre)}`;
    }
    if (!rows.length) {
      detailTb.innerHTML = `<tr><td colspan="6">Cierre sin lineas de detalle.</td></tr>`;
      return;
    }

    detailTb.innerHTML = rows
      .map(
        (x) => `
        <tr>
          <td>${escapeHtml(x.nombre_producto || "")}</td>
          <td>${escapeHtml(x.sku || "")}</td>
          <td>${fmtQty(x.existencia_inicial)}</td>
          <td>${fmtQty(x.entradas_dia)}</td>
          <td>${fmtQty(x.salidas_dia)}</td>
          <td>${fmtQty(x.existencia_cierre)}</td>
        </tr>
      `
      )
      .join("");
  } catch {
    detailTb.innerHTML = `<tr><td colspan="6">Error de red.</td></tr>`;
    if (meta) meta.textContent = "Error de red";
    repCloseSelectedDate = "";
    repCloseSelectedWarehouseId = 0;
    repCloseSelectedSummary = null;
  }
}

async function openCloseHistoryModal() {
  const modal = $("#repDiaHistoryModal");
  if (!modal) return;
  modal.classList.remove("hidden");
  await loadCloseHistoryWarehouseFilter();
  await loadCloseHistoryList("all");
}

function closeCloseHistoryModal() {
  $("#repDiaHistoryModal")?.classList.add("hidden");
}

if ($("#repDiaSearch")) {
  $("#repDiaSearch").onclick = loadReporteCorteDiario;
}

if ($("#repDiaClear")) {
  $("#repDiaClear").onclick = () => {
    if ($("#repDiaQuery")) $("#repDiaQuery").value = "";
    if ($("#repDiaShowAll")) $("#repDiaShowAll").checked = false;
    if ($("#repDiaWarehouse")) {
      if (repDiaCanAllBodegas) {
        $("#repDiaWarehouse").value = "";
      } else {
        const first = $("#repDiaWarehouse").options[0];
        $("#repDiaWarehouse").value = first ? first.value : "";
      }
    }
    repDiaRowsCache = [];
    if ($("#repDiaList")) $("#repDiaList").innerHTML = `<tr><td colspan="7">Usa los filtros y presiona Buscar.</td></tr>`;
    if ($("#repDiaMeta")) $("#repDiaMeta").textContent = "Sin datos";
    if ($("#repDiaResume")) $("#repDiaResume").innerHTML = `<span class="pill ghost">Sin datos</span>`;
    clearReporteCorteValidationMessage();
  };
}

if ($("#repDiaPdf")) {
  $("#repDiaPdf").onclick = () => {
    openReporteCortePrint("carta");
  };
}

function openReporteCortePrint(format = "carta") {
  const q = ($("#repDiaQuery")?.value || "").trim();
  const showAll = $("#repDiaShowAll")?.checked ? "1" : "0";
  const idBodega = Number($("#repDiaWarehouse")?.value || 0);
  const tk = encodeURIComponent(token || "");
  const qs = new URLSearchParams({ token: tk, q, show_all: showAll, limit: "3000", format });
  if (idBodega > 0) qs.set("warehouse", String(idBodega));
  window.open(`${API_ORIGIN}/api/print/corte-diario?${qs.toString()}`, "_blank");
}

if ($("#repDiaClose")) {
  $("#repDiaClose").onclick = realizarCierreDiaManual;
}

if ($("#repDiaApplyCount")) {
  $("#repDiaApplyCount").onclick = guardarSalidasPorConteoFinal;
}

if ($("#repDiaHistory")) {
  $("#repDiaHistory").onclick = openCloseHistoryModal;
}
if ($("#repDiaHistoryClose")) {
  $("#repDiaHistoryClose").onclick = closeCloseHistoryModal;
}
if ($("#repCloseSearchBtn")) {
  $("#repCloseSearchBtn").onclick = () => {
    const fecha = $("#repCloseSearchDate")?.value || "";
    if (!fecha) {
      showEntToast("Selecciona una fecha para buscar el cierre.", "bad");
      return;
    }
    loadCloseHistoryList("date");
  };
}
if ($("#repCloseAllBtn")) {
  $("#repCloseAllBtn").onclick = () => loadCloseHistoryList("all");
}
if ($("#repCloseWarehouse")) {
  $("#repCloseWarehouse").onchange = () => loadCloseHistoryList("all");
}
if ($("#repCloseSearchDate")) {
  $("#repCloseSearchDate").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const fecha = $("#repCloseSearchDate")?.value || "";
      if (!fecha) {
        showEntToast("Selecciona una fecha para buscar el cierre.", "bad");
        return;
      }
      loadCloseHistoryList("date");
    }
  });
}
if ($("#repDiaHistoryModal")) {
  $("#repDiaHistoryModal").addEventListener("click", (e) => {
    if (e.target?.id === "repDiaHistoryModal") closeCloseHistoryModal();
  });
}

if ($("#repDiaQuery")) {
  $("#repDiaQuery").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      loadReporteCorteDiario();
    }
  });
}

if ($("#repDiaWarehouse")) {
  $("#repDiaWarehouse").onchange = () => loadReporteCorteDiario();
}

if ($("#salCountSearch")) {
  $("#salCountSearch").onclick = loadSalidaConteoFinal;
}

if ($("#salCountClear")) {
  $("#salCountClear").onclick = () => {
    if ($("#salCountQuery")) $("#salCountQuery").value = "";
    if ($("#salCountShowAll")) $("#salCountShowAll").checked = false;
    if ($("#salCountWarehouse")) {
      if (salCountCanAllBodegas) {
        $("#salCountWarehouse").value = "";
      } else {
        const first = $("#salCountWarehouse").options[0];
        $("#salCountWarehouse").value = first ? first.value : "";
      }
    }
    salCountRowsCache = [];
    if ($("#salCountList")) $("#salCountList").innerHTML = `<tr><td colspan="8">Usa los filtros y presiona Buscar.</td></tr>`;
    if ($("#salCountMeta")) $("#salCountMeta").textContent = "Sin datos";
    updateSalidaConteoSummary();
  };
}

if ($("#salCountSave")) {
  $("#salCountSave").onclick = guardarSalidaConteoFinalDesdeSalidas;
}

if ($("#salCountQuery")) {
  $("#salCountQuery").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      loadSalidaConteoFinal();
    }
  });
}

if ($("#salCountWarehouse")) {
  $("#salCountWarehouse").onchange = () => loadSalidaConteoFinal();
}

if ($("#salCountList")) {
  $("#salCountList").addEventListener("input", (e) => {
    if (e.target?.matches?.("[data-sal-count-final]")) {
      updateSalidaConteoSummary();
    }
  });
  $("#salCountList").addEventListener("keydown", (e) => {
    const target = e.target;
    if (!target?.matches?.("[data-sal-count-final]")) return;
    if (e.key === "Enter") {
      e.preventDefault();
      const inputs = Array.from(document.querySelectorAll("[data-sal-count-final]"));
      const idx = inputs.indexOf(target);
      const next = inputs[idx + 1];
      if (next) {
        next.focus();
        next.select?.();
      } else {
        $("#salCountSave")?.focus();
      }
    }
  });
}

if ($("#repExistSearch")) {
  $("#repExistSearch").onclick = loadReporteExistencias;
}

if ($("#repExistWarehouse")) {
  $("#repExistWarehouse").onchange = () => scheduleLoadReporteExistencias(120);
}

if ($("#repExistSubcategoria")) {
  $("#repExistSubcategoria").onchange = () => scheduleLoadReporteExistencias(140);
}

if ($("#repHeadProducto")) {
  $("#repHeadProducto").addEventListener("input", () => {
    if ($("#repExistQuery")) $("#repExistQuery").value = String($("#repHeadProducto").value || "").trim();
    scheduleLoadReporteExistencias(220);
  });
}

if ($("#repExistClear")) {
  $("#repExistClear").onclick = () => {
    if ($("#repExistWarehouse")) {
      if (!repExistCanView) {
        $("#repExistWarehouse").value = "";
      } else if (repExistCanAllBodegas) {
        $("#repExistWarehouse").value = "";
      } else {
        const first = $("#repExistWarehouse").options[0];
        $("#repExistWarehouse").value = first ? first.value : "";
      }
    }
    if ($("#repExistQuery")) $("#repExistQuery").value = "";
    if ($("#repExistCategoria")) $("#repExistCategoria").value = "";
    if ($("#repExistSubcategoria")) $("#repExistSubcategoria").innerHTML = `<option value="">Todas las subcategorias</option>`;
    if ($("#repDateFrom")) $("#repDateFrom").value = "";
    if ($("#repDateTo")) $("#repDateTo").value = "";
    if ($("#repMoveDays")) $("#repMoveDays").value = "15";
    if ($("#repHeadBodega")) $("#repHeadBodega").value = "";
    if ($("#repHeadProducto")) $("#repHeadProducto").value = "";
    if ($("#repHeadStock")) $("#repHeadStock").value = "";
    if ($("#repHeadNivel")) $("#repHeadNivel").value = "";
    if ($("#repHeadEstado")) $("#repHeadEstado").value = "";
    if ($("#repHeadRegla")) $("#repHeadRegla").value = "";
    refreshRepExistMultiFilters();
    repExistRowsCache = [];
    repExistExpanded.clear();
    if ($("#repExistList")) $("#repExistList").innerHTML = `<tr><td colspan="9">Usa los filtros y presiona Buscar.</td></tr>`;
    if ($("#repAlertList")) $("#repAlertList").innerHTML = `<tr><td colspan="8">Usa los filtros y presiona Buscar.</td></tr>`;
    if ($("#repAlertResume")) $("#repAlertResume").textContent = "Sin datos";
    if ($("#repExistResume")) $("#repExistResume").innerHTML = `<span class="pill ghost">Sin datos</span>`;
  };
}

if ($("#repExistQuery")) {
  $("#repExistQuery").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      loadReporteExistencias();
    }
  });
}

async function exportReporteExistenciasExcel() {
  const headers = [
    "Bodega",
    "Producto",
    "SKU",
    "Total stock",
    "Nivel stock",
    "Total dinero",
    "Estado",
    "Tiempo de rotacion",
  ];
  const groups = groupExistencias(repExistRowsCache);
  if (!groups.length) {
    showEntToast("No hay datos para exportar.", "bad");
    return;
  }
  const moveDays = Math.max(1, Number($("#repMoveDays")?.value || 15));
  const rows = groups.map((g) => [
    g.nombre_bodega || "",
    g.nombre_producto || "",
    g.sku || "",
    String(g.stock_total ?? 0),
    stockNivelText(g.stock_total, g.minimo_stock, g.maximo_stock),
    fmtMoney(g.total_dinero),
    existenciaEstadoText(g.min_dias, moveDays),
    reglaEstadoText(g.min_dias_regla, g.dias_alerta_antes, g.max_dias_vida),
  ]);

  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const logoWarehouseId = Number($("#repExistWarehouse")?.value || 0) || Number(me?.id_warehouse || 0) || null;
  const okStyled = await exportStyledXls({
    headers,
    bodyRows: rows,
    fileName: `reporte_existencias_${stamp}.xls`,
    sheetName: "Existencias",
    reportTitle: "Reporte de Existencias Jardines del Lago",
    logoWarehouseId,
    headerColor: "0EA5E9",
  });
  if (okStyled) return;
  showEntToast("No se pudo generar el archivo Excel.", "bad");
}

if ($("#repExistExport")) {
  $("#repExistExport").onclick = exportReporteExistenciasExcel;
}

async function exportReporteCierresExcel() {
  const tb = $("#repCloseDetailList");
  const detailTable = tb?.closest("table");
  const headRow = detailTable?.querySelector("thead tr");
  if (!tb || !headRow) return;

  const headers = Array.from(headRow.querySelectorAll("th"))
    .map((th) => String(th.textContent || "").trim());
  const bodyRows = Array.from(tb.querySelectorAll("tr"))
    .map((tr) => Array.from(tr.querySelectorAll("td")))
    .filter((cells) => cells.length && !(cells.length === 1 && Number(cells[0].colSpan || 0) > 1))
    .map((cells) => cells.map((td) => String(td.textContent || "").trim()))
    .filter((row) => row.length);

  if (!bodyRows.length || !repCloseSelectedSummary) {
    showEntToast("Selecciona un cierre con detalle para exportar.", "bad");
    return;
  }

  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const c = repCloseSelectedSummary || {};
  const warehouseLabel = c.nombre_bodega || (repCloseSelectedWarehouseId ? `#${repCloseSelectedWarehouseId}` : "-");
  const dateLabel = fmtDateOnly(repCloseSelectedDate || c.fecha_cierre || "");
  const totalEntradas = fmtQty(c.total_entradas);
  const totalSalidas = fmtQty(c.total_salidas);
  const totalExistencia = fmtQty(c.total_existencia_cierre);
  const bodyRowsWithMeta = [
    ["Bodega", warehouseLabel, "", "", "", ""],
    ["Fecha cierre", dateLabel, "", "", "", ""],
    ["Entradas", totalEntradas, "Salidas", totalSalidas, "Existencia cierre", totalExistencia],
    ["", "", "", "", "", ""],
    ...bodyRows,
  ];
  const logoWarehouseId = repCloseSelectedWarehouseId || Number(me?.id_warehouse || 0) || null;
  const fileDate = repCloseSelectedDate || toYmd(c.fecha_cierre || "") || "detalle";
  const okStyled = await exportStyledXls({
    headers,
    bodyRows: bodyRowsWithMeta,
    fileName: `detalle_cierre_${fileDate}_${stamp}.xls`,
    sheetName: "Detalle cierre",
    reportTitle: "Detalle de Cierre Jardines del Lago",
    logoWarehouseId,
    headerColor: "0F766E",
  });
  if (okStyled) return;
  showEntToast("No se pudo generar el archivo Excel.", "bad");
}

if ($("#repCloseExport")) {
  $("#repCloseExport").onclick = exportReporteCierresExcel;
}

function fmtMoney(v) {
  const n = Number(v || 0);
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDateOnly(v) {
  if (!v) return "";
  const s = String(v).trim();
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) return s;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s.replace(/\//g, "-");
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const yyyy = s.slice(0, 4);
    const mm = s.slice(5, 7);
    const dd = s.slice(8, 10);
    return `${dd}-${mm}-${yyyy}`;
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return s;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${dd}-${mm}-${yyyy}`;
}

function toYmd(v) {
  if (!v) return "";
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split("-");
    return `${yyyy}-${mm}-${dd}`;
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function renderResumenCantidadDinero(targetId, cantidad, dinero) {
  const box = $(targetId);
  if (!box) return;
  box.innerHTML = `
    <span class="pill">Total cantidad: <strong>${fmtMoney(cantidad)}</strong></span>
    <span class="pill">Total dinero: <strong>${fmtMoney(dinero)}</strong></span>
  `;
}

async function loadReporteEntradas() {
  const tb = $("#repEntList");
  if (!tb) return;
  const canManageDashboardFlag = myIsAdminRole && hasPerm("action.manage_permissions");
  const visibleCols = canManageDashboardFlag ? 17 : 16;
  const panelHead = $("#repEntPanelHead");
  if (panelHead) panelHead.style.display = canManageDashboardFlag ? "" : "none";
  if (!repEntCanView) {
    tb.innerHTML = `<tr><td colspan="${visibleCols}">Sin permiso para ver entradas.</td></tr>`;
    if ($("#repEntResume")) $("#repEntResume").innerHTML = `<span class="pill ghost">Sin permiso</span>`;
    return;
  }

  const qs = new URLSearchParams({
    q: ($("#repEntQuery")?.value || "").trim(),
    lote: ($("#repEntLote")?.value || "").trim(),
    from: $("#repEntDateFrom")?.value || "",
    to: $("#repEntDateTo")?.value || "",
    categoria: $("#repEntCategoria")?.value || "",
    subcategoria: $("#repEntSubcategoria")?.value || "",
    motivo: $("#repEntMotivo")?.value || "",
    documento: ($("#repEntDocumento")?.value || "").trim(),
    limit: "1000",
  });
  const warehouse = Number($("#repEntWarehouse")?.value || 0) || "";
  if (warehouse) qs.set("warehouse", String(warehouse));

  tb.innerHTML = `<tr><td colspan="${visibleCols}">Cargando...</td></tr>`;
  try {
    const r = await fetch(`/api/reportes/entradas?${qs.toString()}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) {
      tb.innerHTML = `<tr><td colspan="${visibleCols}">Error al cargar reporte.</td></tr>`;
      if ($("#repEntResume")) $("#repEntResume").innerHTML = `<span class="pill ghost">Error</span>`;
      return;
    }
    if (!Array.isArray(rows) || !rows.length) {
      tb.innerHTML = `<tr><td colspan="${visibleCols}">Sin entradas con esos filtros.</td></tr>`;
      if ($("#repEntResume")) $("#repEntResume").innerHTML = `<span class="pill ghost">Sin datos</span>`;
      return;
    }
    const totalCantidad = rows.reduce((a, x) => a + Number(x.cantidad || 0), 0);
    const totalDinero = rows.reduce((a, x) => a + Number(x.total_linea || 0), 0);
    renderResumenCantidadDinero("#repEntResume", totalCantidad, totalDinero);
    tb.innerHTML = rows
      .map(
        (x) => `
        <tr>
          <td>${fmtDateOnly(x.fecha)}</td>
          <td>${String(x.hora || "").slice(0, 8)}</td>
          <td>${x.id_movimiento ?? ""}</td>
          <td>${x.nombre_bodega || ""}</td>
          <td>${x.nombre_producto || ""}</td>
          <td>${x.sku || ""}</td>
          <td>${x.nombre_categoria || ""}</td>
          <td>${x.nombre_subcategoria || ""}</td>
          <td>${x.lote || ""}</td>
          <td>${fmtDateOnly(x.fecha_vencimiento)}</td>
          <td>${x.cantidad ?? 0}</td>
          <td>${fmtMoney(x.costo_unitario)}</td>
          <td>${fmtMoney(x.total_linea)}</td>
          <td>${x.tipo_entrada === "TRANSFERENCIA" ? "Transferencia" : x.nombre_motivo || ""}</td>
          <td>${x.no_documento || ""}</td>
          <td>${x.usuario_creador || ""}</td>
          ${canManageDashboardFlag ? `<td>${renderEntradaDashboardCell(x)}</td>` : ""}
        </tr>
      `
      )
      .join("");
  } catch {
    tb.innerHTML = `<tr><td colspan="${visibleCols}">Error de red.</td></tr>`;
    if ($("#repEntResume")) $("#repEntResume").innerHTML = `<span class="pill ghost">Error de red</span>`;
  }
}

function renderEntradaDashboardCell(row) {
  const excluded = Number(row?.no_contar_dashboard || 0) === 1;
  const movementId = Number(row?.id_movimiento || 0);
  const label = excluded ? "Excluida" : "Incluida";
  const badgeClass = excluded ? "warn" : "ok";
  if (!(myIsAdminRole && hasPerm("action.manage_permissions")) || !movementId) {
    return `<span class="pill ${badgeClass}">${label}</span>`;
  }
  return `
    <div class="repEntDashboardCell">
      <span class="pill ${badgeClass}">${label}</span>
      <button
        class="btn soft btn-sm"
        type="button"
        data-ent-dashboard-toggle="${movementId}"
        data-ent-dashboard-next="${excluded ? 0 : 1}"
      >${excluded ? "Contar" : "Excluir"}</button>
    </div>
  `;
}

async function toggleEntradaDashboardFlag(idMovimiento, nextValue) {
  const id = Number(idMovimiento || 0);
  if (!id) return;
  const exclude = Number(nextValue || 0) === 1 ? 1 : 0;
  const ok = await uiConfirm(
    exclude
      ? `La entrada #${id} dejara de contar en el panel principal. Deseas continuar?`
      : `La entrada #${id} volvera a contar en el panel principal. Deseas continuar?`,
    exclude ? "Excluir del panel principal" : "Reincluir en panel principal"
  );
  if (!ok) return;
  try {
    const r = await fetch(`/api/entradas/${id}/dashboard-flag`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ no_contar_dashboard: exclude ? 1 : 0 }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      showEntToast(j.error || "No se pudo actualizar la exclusion del panel principal.", "bad");
      return;
    }
    showEntToast(
      exclude
        ? `Entrada #${id} excluida del panel principal.`
        : `Entrada #${id} incluida nuevamente en el panel principal.`,
      "ok"
    );
    await loadReporteEntradas();
  } catch {
    showEntToast("Error de red al actualizar exclusion del panel principal.", "bad");
  }
}

if ($("#repEntList")) {
  $("#repEntList").addEventListener("click", async (e) => {
    const btn = e.target?.closest?.("[data-ent-dashboard-toggle]");
    if (!btn) return;
    if (!hasPerm("action.manage_permissions")) {
      showEntToast("No tienes permiso para administrar exclusiones del panel principal.", "bad");
      return;
    }
    btn.disabled = true;
    try {
      await toggleEntradaDashboardFlag(btn.dataset.entDashboardToggle, btn.dataset.entDashboardNext);
    } finally {
      btn.disabled = false;
    }
  });
}

if ($("#repEntCategoria")) {
  $("#repEntCategoria").addEventListener("change", () => {
    loadReporteEntradasSubcategorias();
  });
}

if ($("#repEntSearch")) {
  $("#repEntSearch").onclick = async () => {
    await loadReporteEntradasCatalogos();
    loadReporteEntradas();
  };
}

if ($("#repEntClear")) {
  $("#repEntClear").onclick = () => {
    if ($("#repEntWarehouse")) {
      if (!repEntCanView) {
        $("#repEntWarehouse").value = "";
      } else if (repEntCanAllBodegas) {
        $("#repEntWarehouse").value = "";
      } else {
        const first = $("#repEntWarehouse").options[0];
        $("#repEntWarehouse").value = first ? first.value : "";
      }
    }
    if ($("#repEntQuery")) $("#repEntQuery").value = "";
    if ($("#repEntLote")) $("#repEntLote").value = "";
    if ($("#repEntDateFrom")) $("#repEntDateFrom").value = "";
    if ($("#repEntDateTo")) $("#repEntDateTo").value = "";
    if ($("#repEntCategoria")) $("#repEntCategoria").value = "";
    if ($("#repEntSubcategoria")) $("#repEntSubcategoria").innerHTML = `<option value="">Todas las subcategorias</option>`;
    if ($("#repEntMotivo")) $("#repEntMotivo").value = "";
    if ($("#repEntDocumento")) $("#repEntDocumento").value = "";
    if ($("#repEntList")) $("#repEntList").innerHTML = `<tr><td colspan="16">Usa los filtros y presiona Buscar.</td></tr>`;
    if ($("#repEntResume")) $("#repEntResume").innerHTML = `<span class="pill ghost">Sin datos</span>`;
  };
}

if ($("#repEntQuery")) {
  $("#repEntQuery").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      loadReporteEntradas();
    }
  });
}

if ($("#repEntLote")) {
  $("#repEntLote").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      loadReporteEntradas();
    }
  });
}

if ($("#repEntDocumento")) {
  $("#repEntDocumento").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      loadReporteEntradas();
    }
  });
}

function escapeHtml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toDateOnlyForExport(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  return fmtDateOnly(s);
}

function normalizeExportValue(header, value) {
  const h = String(header || "").toLowerCase();
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const isDateColumn = h.includes("fecha") || h.includes("vence") || h.includes("vencimiento");
  if (isDateColumn && !h.includes("hora")) return toDateOnlyForExport(raw);
  return raw;
}

let exportLogoAssetCache = null;
let exportLogoBase64Failed = false;
const exportLogoWarehouseCache = new Map();
function getImageExtensionFromMime(mime) {
  const normalized = String(mime || "").toLowerCase().trim();
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/png") return "png";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/gif") return "gif";
  return "png";
}

function buildLogoAssetFromDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,([a-z0-9+/=\\r\\n]+)$/i);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const base64 = match[2].replace(/\s+/g, "");
  if (!base64) return null;
  const ext = getImageExtensionFromMime(mime);
  const contentLocation = `file:///C:/logo_jdl.${ext}`;
  return {
    mime,
    base64,
    contentLocation,
    htmlSrc: contentLocation,
  };
}

if ($("#repExistCategoria")) {
  $("#repExistCategoria").addEventListener("change", async () => {
    await loadReporteExistenciasSubcategorias();
    scheduleLoadReporteExistencias(160);
  });
}

async function getExportLogoAsset(logoWarehouseId = null) {
  const id = Number(logoWarehouseId || 0);
  if (id > 0) {
    if (exportLogoWarehouseCache.has(id)) return exportLogoWarehouseCache.get(id) || null;
    try {
      const data = await fetchWarehouseLogoData(id, "print");
      const asset = buildLogoAssetFromDataUrl(data);
      if (asset) {
        exportLogoWarehouseCache.set(id, asset);
        return asset;
      }
    } catch {
      exportLogoWarehouseCache.set(id, null);
    }
  }
  if (exportLogoAssetCache) return exportLogoAssetCache;
  if (exportLogoBase64Failed) return "";
  try {
    const r = await fetch("/imagenes/Oficial_JDL_acua.png");
    if (!r.ok) throw new Error("logo");
    const blob = await r.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ""));
      fr.onerror = () => reject(new Error("logo-reader"));
      fr.readAsDataURL(blob);
    });
    const asset = buildLogoAssetFromDataUrl(dataUrl);
    exportLogoAssetCache = asset;
    return asset;
  } catch {
    exportLogoBase64Failed = true;
    return null;
  }
}

function chunkBase64(s, size = 76) {
  const out = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out.join("\\r\\n");
}

function buildMhtmlExcel({ html, logoAsset }) {
  const boundary = "----=_NextPart_000_0000_01D00000";
  const logoPart = logoAsset?.base64
    ? `--${boundary}\r
Content-Location:${logoAsset.contentLocation}\r
Content-Transfer-Encoding:base64\r
Content-Type:${logoAsset.mime}\r
\r
${chunkBase64(logoAsset.base64)}\r
`
    : "";

  return `MIME-Version: 1.0\r
Content-Type: multipart/related; boundary="${boundary}"\r
\r
--${boundary}\r
Content-Location:file:///C:/reporte.htm\r
Content-Transfer-Encoding:8bit\r
Content-Type:text/html; charset="utf-8"\r
\r
${html}\r
${logoPart}--${boundary}--`;
}

async function exportStyledXls({ headers, bodyRows, fileName, sheetName, reportTitle, logoWarehouseId = null }) {
  if (!Array.isArray(headers) || !headers.length || !Array.isArray(bodyRows)) return false;
  const titleBg = "#0F172A";
  const headerBg = "#1E293B";
  const metaBg = "#E2E8F0";
  const borderDark = "#334155";
  const borderSoft = "#CBD5E1";
  const rowEven = "#FFFFFF";
  const rowOdd = "#F8FAFC";
  const textMain = "#0F172A";
  const textSoft = "#334155";
  const title = escapeHtml(reportTitle || `Reporte de ${sheetName || "Inventario"} Jardines del Lago`);
  const exportedAt = escapeHtml(fmtDateTime(new Date()));
  const generatedByRaw = (me?.full_name || me?.username || me?.nombre_usuario || "Usuario").toString().trim();
  const generatedBy = escapeHtml(generatedByRaw || "Usuario");
  const logoAsset = await getExportLogoAsset(logoWarehouseId);
  const logoHeightPx = 58;
  const logoHtml = logoAsset?.htmlSrc
    ? `<img src="${logoAsset.htmlSrc}" alt="Logo Jardines del Lago" height="${logoHeightPx}" style="display:block;height:${logoHeightPx}px;width:auto;" />`
    : "";
  const colSpan = Math.max(1, headers.length);
  const normalizedRows = bodyRows.map((row) => headers.map((h, i) => normalizeExportValue(h, row?.[i])));
  const isNumericHeader = (h) => {
    const x = String(h || "").toLowerCase();
    return (
      x.includes("total") ||
      x.includes("stock") ||
      x.includes("cantidad") ||
      x.includes("costo") ||
      x.includes("precio") ||
      x.includes("dias")
    );
  };

  const thHtml = headers
    .map(
      (h) =>
        `<th style="border:1px solid ${borderDark};padding:9px 10px;font-weight:700;background:${headerBg};color:#ffffff;text-align:left;white-space:nowrap;text-transform:uppercase;font-size:11px;letter-spacing:.04em;">${escapeHtml(h)}</th>`
    )
    .join("");
  const rowsHtml = normalizedRows
    .map((row, idx) => {
      const bg = idx % 2 === 1 ? rowOdd : rowEven;
      const cells = headers
        .map((h, i) => {
          const align = isNumericHeader(h) ? "right" : "left";
          return `<td style="border:1px solid ${borderSoft};padding:7px 10px;text-align:${align};background:${bg};color:${textMain};">${escapeHtml(row?.[i])}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
</head>
<body>
<table border="0" cellspacing="0" cellpadding="0" style="font-family:'Segoe UI', Arial, sans-serif;border-collapse:collapse;">
<tbody>
<tr>
  <td colspan="${colSpan}" height="${logoHeightPx + 8}" style="padding:4px 0;height:${logoHeightPx + 8}px;vertical-align:middle;">${logoHtml}</td>
</tr>
<tr>
  <td colspan="${colSpan}" style="padding:10px 12px;background:${titleBg};color:#E2E8F0;border:1px solid ${titleBg};font-size:18px;font-weight:700;">${title}</td>
</tr>
<tr>
  <td colspan="${colSpan}" style="padding:7px 12px;background:${metaBg};color:${textSoft};border:1px solid ${borderSoft};font-size:12px;font-weight:600;">Generado: ${exportedAt} | Usuario: ${generatedBy}</td>
</tr>
<tr>${thHtml}</tr>
${rowsHtml}
</tbody>
</table>
</body>
</html>`;

  const xlsContent = buildMhtmlExcel({ html, logoAsset });
  const blob = new Blob([xlsContent], { type: "application/vnd.ms-excel;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}

async function exportReporteEntradasExcel() {
  const tb = $("#repEntList");
  const headRow = document.querySelector("#view-r-entradas table thead tr");
  if (!tb || !headRow) return;

  const headers = Array.from(headRow.querySelectorAll("th")).map((th) =>
    String(th.textContent || "").trim()
  );
  const bodyRows = Array.from(tb.querySelectorAll("tr"))
    .map((tr) => Array.from(tr.querySelectorAll("td")))
    .filter((cells) => {
      if (!cells.length) return false;
      if (cells.length === 1 && Number(cells[0].colSpan || 0) > 1) return false;
      return true;
    })
    .map((cells) => cells.map((td) => String(td.textContent || "").trim()));

  if (!bodyRows.length) {
    showEntToast("No hay datos en la tabla para exportar.", "bad");
    return;
  }
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const logoWarehouseId = Number($("#repEntWarehouse")?.value || 0) || Number(me?.id_warehouse || 0) || null;
  const okStyled = await exportStyledXls({
    headers,
    bodyRows,
    fileName: `reporte_entradas_${stamp}.xls`,
    sheetName: "Entradas",
    reportTitle: "Reporte de Entradas Jardines del Lago",
    logoWarehouseId,
    headerColor: "0F766E",
  });
  if (okStyled) return;
  showEntToast("No se pudo generar el archivo Excel.", "bad");
}

if ($("#repEntExport")) {
  $("#repEntExport").onclick = exportReporteEntradasExcel;
}

async function loadReporteSalidas() {
  const tb = $("#repSalList");
  if (!tb) return;
  if (!repSalCanView) {
    tb.innerHTML = `<tr><td colspan="19">Sin permiso para ver salidas.</td></tr>`;
    if ($("#repSalResume")) $("#repSalResume").innerHTML = `<span class="pill ghost">Sin permiso</span>`;
    return;
  }

  const qs = new URLSearchParams({
    q: ($("#repSalQuery")?.value || "").trim(),
    lote: ($("#repSalLote")?.value || "").trim(),
    from: $("#repSalDateFrom")?.value || "",
    to: $("#repSalDateTo")?.value || "",
    categoria: $("#repSalCategoria")?.value || "",
    subcategoria: $("#repSalSubcategoria")?.value || "",
    motivo: $("#repSalMotivo")?.value || "",
    documento: ($("#repSalDocumento")?.value || "").trim(),
    limit: "1000",
  });
  const warehouse = Number($("#repSalWarehouse")?.value || 0) || "";
  const warehouseDestino = Number($("#repSalWarehouseDestino")?.value || 0) || "";
  if (warehouse) qs.set("warehouse", String(warehouse));
  if (warehouseDestino) qs.set("warehouse_destino", String(warehouseDestino));

  tb.innerHTML = `<tr><td colspan="19">Cargando...</td></tr>`;
  try {
    const r = await fetch(`/api/reportes/salidas?${qs.toString()}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) {
      tb.innerHTML = `<tr><td colspan="19">Error al cargar reporte.</td></tr>`;
      if ($("#repSalResume")) $("#repSalResume").innerHTML = `<span class="pill ghost">Error</span>`;
      return;
    }
    if (!Array.isArray(rows) || !rows.length) {
      tb.innerHTML = `<tr><td colspan="19">Sin salidas con esos filtros.</td></tr>`;
      if ($("#repSalResume")) $("#repSalResume").innerHTML = `<span class="pill ghost">Sin datos</span>`;
      return;
    }
    const totalCantidad = rows.reduce((a, x) => a + Number(x.cantidad || 0), 0);
    const totalDinero = rows.reduce((a, x) => a + Number(x.total_linea || 0), 0);
    renderResumenCantidadDinero("#repSalResume", totalCantidad, totalDinero);
    tb.innerHTML = rows
      .map(
        (x) => `
        <tr>
          <td>${fmtDateOnly(x.fecha || x.creado_en)}</td>
          <td>${String(x.hora || "").slice(0, 8)}</td>
          <td>${x.id_movimiento ?? ""}</td>
          <td>${x.tipo_salida || ""}</td>
          <td>${x.nombre_bodega_origen || ""}</td>
          <td>${x.nombre_bodega_destino || ""}</td>
          <td>${x.nombre_producto || ""}</td>
          <td>${x.sku || ""}</td>
          <td>${x.nombre_categoria || ""}</td>
          <td>${x.nombre_subcategoria || ""}</td>
          <td>${x.lote || ""}</td>
          <td>${fmtDateOnly(x.fecha_vencimiento)}</td>
          <td>${x.cantidad ?? 0}</td>
          <td>${fmtMoney(x.costo_unitario)}</td>
          <td>${fmtMoney(x.total_linea)}</td>
          <td>${x.nombre_motivo || ""}</td>
          <td>${x.no_documento || ""}</td>
          <td>${x.solicitante_pedido || ""}</td>
          <td>${x.usuario_creador || ""}</td>
        </tr>
      `
      )
      .join("");
  } catch {
    tb.innerHTML = `<tr><td colspan="19">Error de red.</td></tr>`;
    if ($("#repSalResume")) $("#repSalResume").innerHTML = `<span class="pill ghost">Error de red</span>`;
  }
}

if ($("#repSalCategoria")) {
  $("#repSalCategoria").addEventListener("change", () => {
    loadReporteSalidasSubcategorias();
  });
}

if ($("#repSalSearch")) {
  $("#repSalSearch").onclick = async () => {
    await loadReporteSalidasCatalogos();
    loadReporteSalidas();
  };
}

if ($("#repSalClear")) {
  $("#repSalClear").onclick = () => {
    if ($("#repSalWarehouse")) {
      if (!repSalCanView) {
        $("#repSalWarehouse").value = "";
      } else if (repSalCanAllBodegas) {
        $("#repSalWarehouse").value = "";
      } else {
        const first = $("#repSalWarehouse").options[0];
        $("#repSalWarehouse").value = first ? first.value : "";
      }
    }
    if ($("#repSalQuery")) $("#repSalQuery").value = "";
    if ($("#repSalLote")) $("#repSalLote").value = "";
    if ($("#repSalDateFrom")) $("#repSalDateFrom").value = "";
    if ($("#repSalDateTo")) $("#repSalDateTo").value = "";
    if ($("#repSalCategoria")) $("#repSalCategoria").value = "";
    if ($("#repSalSubcategoria")) $("#repSalSubcategoria").innerHTML = `<option value="">Todas las subcategorias</option>`;
    if ($("#repSalMotivo")) $("#repSalMotivo").value = "";
    if ($("#repSalDocumento")) $("#repSalDocumento").value = "";
    if ($("#repSalWarehouseDestino")) $("#repSalWarehouseDestino").value = "";
    if ($("#repSalList")) $("#repSalList").innerHTML = `<tr><td colspan="19">Usa los filtros y presiona Buscar.</td></tr>`;
    if ($("#repSalResume")) $("#repSalResume").innerHTML = `<span class="pill ghost">Sin datos</span>`;
  };
}

if ($("#repSalQuery")) {
  $("#repSalQuery").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      loadReporteSalidas();
    }
  });
}

if ($("#repSalLote")) {
  $("#repSalLote").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      loadReporteSalidas();
    }
  });
}

if ($("#repSalDocumento")) {
  $("#repSalDocumento").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      loadReporteSalidas();
    }
  });
}

async function exportReporteSalidasExcel() {
  const tb = $("#repSalList");
  const headRow = document.querySelector("#view-r-salidas table thead tr");
  if (!tb || !headRow) return;

  const headers = Array.from(headRow.querySelectorAll("th")).map((th) =>
    String(th.textContent || "").trim()
  );
  const bodyRows = Array.from(tb.querySelectorAll("tr"))
    .map((tr) => Array.from(tr.querySelectorAll("td")))
    .filter((cells) => {
      if (!cells.length) return false;
      if (cells.length === 1 && Number(cells[0].colSpan || 0) > 1) return false;
      return true;
    })
    .map((cells) => cells.map((td) => String(td.textContent || "").trim()));

  if (!bodyRows.length) {
    showEntToast("No hay datos en la tabla para exportar.", "bad");
    return;
  }
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const logoWarehouseId = Number($("#repSalWarehouse")?.value || 0) || Number(me?.id_warehouse || 0) || null;
  const okStyled = await exportStyledXls({
    headers,
    bodyRows,
    fileName: `reporte_salidas_${stamp}.xls`,
    sheetName: "Salidas",
    reportTitle: "Reporte de Salidas Jardines del Lago",
    logoWarehouseId,
    headerColor: "1D4ED8",
  });
  if (okStyled) return;
  showEntToast("No se pudo generar el archivo Excel.", "bad");
}

if ($("#repSalExport")) {
  $("#repSalExport").onclick = exportReporteSalidasExcel;
}

async function loadReportePedidos() {
  const tb = $("#repPedList");
  if (!tb) return;
  if (!repPedCanView) {
    tb.innerHTML = `<tr><td colspan="20">Sin permiso para ver pedidos.</td></tr>`;
    if ($("#repPedResume")) $("#repPedResume").innerHTML = `<span class="pill ghost">Sin permiso</span>`;
    return;
  }

  const qs = new URLSearchParams({
    q: ($("#repPedQuery")?.value || "").trim(),
    lote: ($("#repPedLote")?.value || "").trim(),
    from: $("#repPedDateFrom")?.value || "",
    to: $("#repPedDateTo")?.value || "",
    date_mode: $("#repPedDateMode")?.value || "PEDIDO",
    categoria: $("#repPedCategoria")?.value || "",
    subcategoria: $("#repPedSubcategoria")?.value || "",
    pedido: $("#repPedId")?.value || "",
    estado: $("#repPedEstado")?.value || "",
    requester_user: $("#repPedRequesterUser")?.value || "",
    dispatch_user: $("#repPedDispatchUser")?.value || "",
    limit: "1500",
  });
  const whReq = Number($("#repPedWarehouseReq")?.value || 0) || "";
  const whDesp = Number($("#repPedWarehouseDesp")?.value || 0) || "";
  if (whReq) qs.set("warehouse_requester", String(whReq));
  if (whDesp) qs.set("warehouse_dispatch", String(whDesp));

  tb.innerHTML = `<tr><td colspan="20">Cargando...</td></tr>`;
  try {
    const r = await fetch(`/api/reportes/pedidos?${qs.toString()}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) {
      tb.innerHTML = `<tr><td colspan="20">Error al cargar reporte.</td></tr>`;
      if ($("#repPedResume")) $("#repPedResume").innerHTML = `<span class="pill ghost">Error</span>`;
      return;
    }
    if (!Array.isArray(rows) || !rows.length) {
      tb.innerHTML = `<tr><td colspan="20">Sin pedidos con esos filtros.</td></tr>`;
      if ($("#repPedResume")) $("#repPedResume").innerHTML = `<span class="pill ghost">Sin datos</span>`;
      return;
    }
    const totalCantidad = rows.reduce((a, x) => a + Number(x.cantidad_solicitada || 0), 0);
    const totalDinero = rows.reduce((a, x) => a + Number(x.total_linea || 0), 0);
    renderResumenCantidadDinero("#repPedResume", totalCantidad, totalDinero);

    tb.innerHTML = rows
      .map(
        (x) => `
        <tr>
          <td>${x.id_pedido ?? ""}</td>
          <td>${fmtDateOnly(x.fecha_pedido || x.creado_en)}</td>
          <td>${String(x.hora_pedido || "").slice(0, 8)}</td>
          <td>${x.estado || ""}</td>
          <td>${x.solicitante || ""}</td>
          <td>${x.bodega_solicitante || ""}</td>
          <td>${x.bodega_despacho || ""}</td>
          <td>${x.nombre_producto || ""}</td>
          <td>${x.sku || ""}</td>
          <td>${x.nombre_categoria || ""}</td>
          <td>${x.nombre_subcategoria || ""}</td>
          <td>${x.cantidad_solicitada ?? 0}</td>
          <td>${x.cantidad_surtida ?? 0}</td>
          <td>${x.pendiente ?? 0}</td>
          <td>${fmtMoney(x.total_linea)}</td>
          <td>${x.tipos_salida || ""}</td>
          <td>${x.lotes_despachados || ""}</td>
          <td>${fmtDateOnly(x.ultima_salida_en)}</td>
          <td>${x.usuarios_despacho || x.usuario_aprobador || ""}</td>
          <td>
            <div class="gridActions">
              <button class="btn soft btn-sm" data-reppdf="${x.id_pedido ?? ""}" type="button">PDF</button>
              <button class="btn soft btn-sm" data-reppos="${x.id_pedido ?? ""}" type="button">POS 80mm</button>
            </div>
          </td>
        </tr>
      `
      )
      .join("");

    tb.querySelectorAll("[data-reppdf]").forEach((b) => {
      b.onclick = () => {
        const id = Number(b.dataset.reppdf || 0);
        if (!id) return;
        const tk = encodeURIComponent(token || "");
        window.open(`${API_ORIGIN}/api/print/order/${id}?token=${tk}`, "_blank");
      };
    });

    tb.querySelectorAll("[data-reppos]").forEach((b) => {
      b.onclick = () => {
        const id = Number(b.dataset.reppos || 0);
        if (!id) return;
        const tk = encodeURIComponent(token || "");
        window.open(`${API_ORIGIN}/api/print/order/${id}/pos80?token=${tk}`, "_blank");
      };
    });
  } catch {
    tb.innerHTML = `<tr><td colspan="20">Error de red.</td></tr>`;
    if ($("#repPedResume")) $("#repPedResume").innerHTML = `<span class="pill ghost">Error de red</span>`;
  }
}

if ($("#repPedCategoria")) {
  $("#repPedCategoria").addEventListener("change", () => {
    loadReportePedidosSubcategorias();
  });
}

if ($("#repPedSearch")) {
  $("#repPedSearch").onclick = async () => {
    await loadReportePedidosCatalogos();
    loadReportePedidos();
  };
}

if ($("#repPedClear")) {
  $("#repPedClear").onclick = () => {
    if ($("#repPedWarehouseReq")) {
      if (!repPedCanView) $("#repPedWarehouseReq").value = "";
      else if (repPedCanAllBodegas) $("#repPedWarehouseReq").value = "";
      else {
        const first = $("#repPedWarehouseReq").options[0];
        $("#repPedWarehouseReq").value = first ? first.value : "";
      }
    }
    if ($("#repPedWarehouseDesp")) {
      if (!repPedCanView) $("#repPedWarehouseDesp").value = "";
      else if (repPedCanAllBodegas) $("#repPedWarehouseDesp").value = "";
      else {
        const first = $("#repPedWarehouseDesp").options[0];
        $("#repPedWarehouseDesp").value = first ? first.value : "";
      }
    }
    if ($("#repPedEstado")) $("#repPedEstado").value = "";
    if ($("#repPedQuery")) $("#repPedQuery").value = "";
    if ($("#repPedLote")) $("#repPedLote").value = "";
    if ($("#repPedId")) $("#repPedId").value = "";
    if ($("#repPedCategoria")) $("#repPedCategoria").value = "";
    if ($("#repPedSubcategoria")) $("#repPedSubcategoria").innerHTML = `<option value="">Todas las subcategorias</option>`;
    if ($("#repPedRequesterUser")) $("#repPedRequesterUser").value = "";
    if ($("#repPedDispatchUser")) $("#repPedDispatchUser").value = "";
    if ($("#repPedDateMode")) $("#repPedDateMode").value = "PEDIDO";
    if ($("#repPedDateFrom")) $("#repPedDateFrom").value = "";
    if ($("#repPedDateTo")) $("#repPedDateTo").value = "";
    if ($("#repPedList")) $("#repPedList").innerHTML = `<tr><td colspan="20">Usa los filtros y presiona Buscar.</td></tr>`;
    if ($("#repPedResume")) $("#repPedResume").innerHTML = `<span class="pill ghost">Sin datos</span>`;
  };
}

if ($("#repPedQuery")) {
  $("#repPedQuery").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      loadReportePedidos();
    }
  });
}

if ($("#repPedLote")) {
  $("#repPedLote").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      loadReportePedidos();
    }
  });
}

if ($("#repPedId")) {
  $("#repPedId").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      loadReportePedidos();
    }
  });
}

async function exportReportePedidosExcel() {
  const tb = $("#repPedList");
  const headRow = document.querySelector("#view-r-pedidos table thead tr");
  if (!tb || !headRow) return;
  const allHeaders = Array.from(headRow.querySelectorAll("th")).map((th) => String(th.textContent || "").trim());
  const printColIdx = allHeaders.findIndex((h) => h.toLowerCase() === "imprimir");
  const headers = printColIdx >= 0 ? allHeaders.filter((_, i) => i !== printColIdx) : allHeaders;
  const bodyRows = Array.from(tb.querySelectorAll("tr"))
    .map((tr) => Array.from(tr.querySelectorAll("td")))
    .filter((cells) => cells.length && !(cells.length === 1 && Number(cells[0].colSpan || 0) > 1))
    .map((cells) => {
      const vals = cells.map((td) => String(td.textContent || "").trim());
      if (printColIdx >= 0 && vals.length > printColIdx) return vals.filter((_, i) => i !== printColIdx);
      return vals;
    });
  if (!bodyRows.length) {
    showEntToast("No hay datos en la tabla para exportar.", "bad");
    return;
  }
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const logoWarehouseId =
    Number($("#repPedWarehouseReq")?.value || 0) ||
    Number($("#repPedWarehouseDesp")?.value || 0) ||
    Number(me?.id_warehouse || 0) ||
    null;
  const okStyled = await exportStyledXls({
    headers,
    bodyRows,
    fileName: `reporte_pedidos_${stamp}.xls`,
    sheetName: "Pedidos",
    reportTitle: "Reporte de Pedidos Jardines del Lago",
    logoWarehouseId,
    headerColor: "0EA5E9",
  });
  if (okStyled) return;
  showEntToast("No se pudo generar el archivo Excel.", "bad");
}

if ($("#repPedExport")) {
  $("#repPedExport").onclick = exportReportePedidosExcel;
}


function repTrendShortDate(ymd) {
  const s = String(ymd || "").trim();
  if (!s) return "";
  const dayShort = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];
  const monthShort = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  if (/^\d{4}-\d{2}$/.test(s)) {
    const d = new Date(`${s}-01T00:00:00`);
    if (!Number.isNaN(d.getTime())) {
      return `${monthShort[d.getMonth()]} ${d.getFullYear()}`;
    }
  }
  const y = toYmd(s);
  if (y) {
    const d = new Date(`${y}T00:00:00`);
    if (!Number.isNaN(d.getTime())) {
      return `${dayShort[d.getDay()]} ${String(d.getDate()).padStart(2, "0")} ${monthShort[d.getMonth()]}`;
    }
  }
  return s;
}

function renderTrendBarChart(selector, rows, valueKey, valueFmt, labelResolver) {
  const box = $(selector);
  if (!box) return;
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    box.innerHTML = `<div class="note">Sin datos en este periodo.</div>`;
    return;
  }
  const vals = list.map((r) => Number(r?.[valueKey] || 0));
  const maxVal = Math.max(...vals, 1);
  box.innerHTML = list
    .map((r) => {
      const v = Number(r?.[valueKey] || 0);
      const h = Math.max(10, Math.round((v / maxVal) * 116));
      const labelTxt = typeof labelResolver === "function"
        ? String(labelResolver(r) || "")
        : repTrendShortDate(r.fecha || r.periodo || "");
      const valTxt = typeof valueFmt === "function" ? valueFmt(v, r) : String(v);
      return `
        <div class="repTrendBar" title="${labelTxt}: ${valTxt}">
          <div class="repTrendBarFill" style="height:${h}px"></div>
          <div class="repTrendBarDate">${escapeHtml(labelTxt)}</div>
          <div class="repTrendBarValue">${valTxt}</div>
        </div>
      `;
    })
    .join("");
}

function resetReporteTendenciaVisual(msg = "Selecciona un producto y presiona Buscar.") {
  if ($("#repTrendResume")) $("#repTrendResume").innerHTML = `<span class="pill ghost">${msg}</span>`;
  if ($("#repTrendPriceChart")) $("#repTrendPriceChart").innerHTML = `<div class="note">Sin datos</div>`;
  if ($("#repTrendDemandChart")) $("#repTrendDemandChart").innerHTML = `<div class="note">Sin datos</div>`;
  if ($("#repTrendPriceRows")) $("#repTrendPriceRows").innerHTML = `<tr><td colspan="4">Sin datos</td></tr>`;
  if ($("#repTrendDemandRows")) $("#repTrendDemandRows").innerHTML = `<tr><td colspan="4">Sin datos</td></tr>`;
}

async function loadReporteTendenciaWarehouseFilter(force = false) {
  const sel = $("#repTrendWarehouse");
  if (!sel) return;
  if (repTrendWarehouseLoaded && !force) return;
  try {
    const r = await fetch("/api/reportes/stock-scope", {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    repTrendCanView = Number(j.can_view_existencias) === 1 || j.can_view_existencias === true;
    repTrendCanAllBodegas = Number(j.can_all_bodegas) === 1 || j.can_all_bodegas === true;
    if (!repTrendCanView) {
      sel.innerHTML = `<option value="">Sin acceso</option>`;
      sel.disabled = true;
      repTrendWarehouseLoaded = true;
      return;
    }
    const rows = Array.isArray(j.bodegas) ? j.bodegas : [];
    if (repTrendCanAllBodegas) {
      sel.innerHTML = rows.map((x) => `<option value="${x.id_bodega}">${x.nombre_bodega}</option>`).join("");
    } else {
      sel.innerHTML = rows.length
        ? rows.map((x) => `<option value="${x.id_bodega}">${x.nombre_bodega}</option>`).join("")
        : `<option value="${j.id_bodega_default || me?.id_warehouse || ""}">Mi bodega</option>`;
    }
    if (!sel.value && j.id_bodega_default) sel.value = String(j.id_bodega_default);
    sel.disabled = !repTrendCanAllBodegas;
    repTrendWarehouseLoaded = true;
  } catch {
    showEntToast("No se pudo cargar bodegas para tendencia.", "bad");
  }
}

async function loadReporteTendenciaProducto() {
  await loadReporteTendenciaWarehouseFilter();
  if (!repTrendCanView) {
    resetReporteTendenciaVisual("Sin permiso para ver este reporte.");
    return;
  }
  const hidden = $("#repTrendQuery");
  const picker = $("#repTrendPickProduct");
  let idProducto = Number(hidden?.dataset?.id || picker?.dataset?.id || 0);

  if (!idProducto) {
    const typed = String(picker?.value || hidden?.value || "").trim();
    if (!typed) {
      resetReporteTendenciaVisual("Selecciona un producto para generar la grafica.");
      return;
    }
    const wh = Number($("#repTrendWarehouse")?.value || 0);
    const candidates = await searchProducts(typed, { warehouse: wh > 0 ? wh : null });
    const exact = (Array.isArray(candidates) ? candidates : []).find((p) => {
      const sku = String(p?.sku || "").trim().toLowerCase();
      const name = String(p?.nombre_producto || "").trim().toLowerCase();
      const q = typed.toLowerCase();
      return sku === q || name === q;
    });
    const chosen = exact || (Array.isArray(candidates) && candidates.length === 1 ? candidates[0] : null);
    if (!chosen?.id_producto) {
      showEntToast("Selecciona el producto desde el buscador para cargar la tendencia.", "bad");
      resetReporteTendenciaVisual("Selecciona un producto valido para generar la grafica.");
      return;
    }
    idProducto = Number(chosen.id_producto || 0);
    const pickedText = String(chosen.nombre_producto || chosen.sku || "").trim();
    if (picker) {
      picker.value = pickedText;
      picker.dataset.id = String(chosen.id_producto || "");
      picker.dataset.sku = String(chosen.sku || "");
    }
    if (hidden) {
      hidden.value = pickedText;
      hidden.dataset.id = String(chosen.id_producto || "");
      hidden.dataset.sku = String(chosen.sku || "");
    }
  }

  const qs = new URLSearchParams({ producto: String(idProducto) });
  const wh = Number($("#repTrendWarehouse")?.value || 0);
  if (wh > 0) qs.set("warehouse_base", String(wh));
  const from = toYmd(String($("#repTrendDateFrom")?.value || "").replace(/\//g, "-"));
  const to = toYmd(String($("#repTrendDateTo")?.value || "").replace(/\//g, "-"));
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);

  if ($("#repTrendResume")) $("#repTrendResume").innerHTML = `<span class="pill ghost">Cargando...</span>`;
  try {
    const r = await fetch(`/api/reportes/tendencia-producto?${qs.toString()}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      showEntToast(j.error || "No se pudo cargar tendencia del producto.", "bad");
      resetReporteTendenciaVisual("Error al cargar datos.");
      return;
    }
    const priceIncreases = Array.isArray(j.price_increases) ? j.price_increases : [];
    const priceMonthly = Array.isArray(j.price_monthly) ? j.price_monthly : [];
    const priceStatus = String(j.price_status || "").trim().toLowerCase();
    const demandByDate = Array.isArray(j.demand_by_date) ? j.demand_by_date : [];
    const demandByWarehouse = Array.isArray(j.demand_by_warehouse) ? j.demand_by_warehouse : [];
    const topConsumerWarehouse = j?.top_consumer_warehouse || (demandByWarehouse.length ? demandByWarehouse[0] : null);
    const prodName = j?.producto?.nombre_producto || "Producto";
    const sku = j?.producto?.sku ? ` (${j.producto.sku})` : "";
    const maxPct = priceIncreases.reduce((a, x) => Math.max(a, Number(x.pct_up || 0)), 0);
    const maxQty = demandByDate.reduce((a, x) => Math.max(a, Number(x.cantidad_solicitada || 0)), 0);
    const maxByWarehouse = demandByWarehouse.reduce((a, x) => Math.max(a, Number(x.cantidad_sacada || 0)), 0);
    const totalWarehouseQty = demandByWarehouse.reduce((a, x) => a + Number(x.cantidad_sacada || 0), 0);
    const currentMonthlyPrice = priceMonthly.length ? Number(priceMonthly[priceMonthly.length - 1]?.precio || 0) : 0;
    const statusTxt = priceStatus === "se_mantuvo"
      ? "Se mantuvo el precio"
      : (priceStatus === "subio" ? "Hubo subidas de precio" : "Sin subidas en el periodo");
    if ($("#repTrendResume")) {
      $("#repTrendResume").innerHTML = `
        <span class="pill ghost">${escapeHtml(prodName + sku)}</span>
        <span class="pill">Estado precio: <strong>${statusTxt}</strong></span>
        <span class="pill">Subidas de precio: <strong>${priceIncreases.length}</strong></span>
        <span class="pill">Precio actual periodo: <strong>${fmtMoney(currentMonthlyPrice)}</strong></span>
        <span class="pill">Demanda maxima por fecha: <strong>${fmtQtyDashboard(maxQty)}</strong></span>
        <span class="pill">Bodega con mayor consumo: <strong>${escapeHtml(String(topConsumerWarehouse?.nombre_bodega || "Sin datos"))}</strong> (${fmtQtyDashboard(topConsumerWarehouse?.cantidad_sacada || 0)} | ${totalWarehouseQty > 0 ? ((Number(topConsumerWarehouse?.cantidad_sacada || 0) / totalWarehouseQty) * 100).toFixed(2) : "0.00"}%)</span>
      `;
    }
    if (priceIncreases.length) {
      renderTrendBarChart("#repTrendPriceChart", priceIncreases, "pct_up", (v) => `${Number(v || 0).toFixed(2)}%`);
    } else {
      const monthlyRows = priceMonthly.map((x) => ({ fecha: x.periodo, precio: Number(x.precio || 0) }));
      renderTrendBarChart("#repTrendPriceChart", monthlyRows, "precio", (v) => fmtMoney(v));
    }
    renderTrendBarChart(
      "#repTrendDemandChart",
      demandByWarehouse,
      "cantidad_sacada",
      (v, x) => {
        const pct = totalWarehouseQty > 0 ? ((Number(x?.cantidad_sacada || 0) / totalWarehouseQty) * 100) : 0;
        return `${fmtQtyDashboard(v)} (${pct.toFixed(2)}%)`;
      },
      (x) => x.nombre_bodega || "Bodega"
    );

    if ($("#repTrendPriceRows")) {
      if (priceIncreases.length) {
        $("#repTrendPriceRows").innerHTML = priceIncreases
          .map(
            (x) => `
              <tr>
                <td>${repTrendShortDate(x.fecha)}</td>
                <td>${fmtMoney(x.precio_anterior)}</td>
                <td>${fmtMoney(x.precio_nuevo)}</td>
                <td>${Number(x.pct_up || 0).toFixed(2)}%</td>
              </tr>
            `
          )
          .join("");
      } else if (priceMonthly.length) {
        $("#repTrendPriceRows").innerHTML = priceMonthly
          .map((x, idx) => {
            const prev = idx > 0 ? Number(priceMonthly[idx - 1]?.precio || x.precio || 0) : Number(x.precio || 0);
            const next = Number(x.precio || 0);
            const pct = prev > 0 ? ((next - prev) / prev) * 100 : 0;
            return `
              <tr>
                <td>${repTrendShortDate(x.periodo)}</td>
                <td>${fmtMoney(prev)}</td>
                <td>${fmtMoney(next)}</td>
                <td>${pct.toFixed(2)}%</td>
              </tr>
            `;
          })
          .join("");
      } else {
        $("#repTrendPriceRows").innerHTML = `<tr><td colspan="4">Sin historial de precio en el periodo.</td></tr>`;
      }
    }
    if ($("#repTrendDemandRows")) {
      $("#repTrendDemandRows").innerHTML = demandByWarehouse.length
        ? demandByWarehouse
            .map(
              (x) => `
              <tr>
                <td>${escapeHtml(String(x.nombre_bodega || "Bodega"))}</td>
                <td>${fmtQtyDashboard(x.cantidad_sacada)}</td>
                <td>${fmtQtyDashboard(x.pedidos)}</td>
                <td>${totalWarehouseQty > 0 ? ((Number(x.cantidad_sacada || 0) / totalWarehouseQty) * 100).toFixed(2) : "0.00"}%</td>
              </tr>
            `
            )
            .join("")
        : `<tr><td colspan="4">Sin consumo de otras bodegas en el periodo.</td></tr>`;
    }
  } catch {
    showEntToast("Error de red cargando tendencia de producto.", "bad");
    resetReporteTendenciaVisual("Error de red");
  }
}

if ($("#repTrendSearch")) {
  $("#repTrendSearch").onclick = loadReporteTendenciaProducto;
}
if ($("#repTrendClear")) {
  $("#repTrendClear").onclick = async () => {
    if ($("#repTrendDateFrom")) $("#repTrendDateFrom").value = "";
    if ($("#repTrendDateTo")) $("#repTrendDateTo").value = "";
    if ($("#repTrendPickProduct")) $("#repTrendPickProduct").value = "";
    if ($("#repTrendQuery")) {
      $("#repTrendQuery").value = "";
      delete $("#repTrendQuery").dataset.id;
      delete $("#repTrendQuery").dataset.sku;
    }
    await loadReporteTendenciaWarehouseFilter(true);
    resetReporteTendenciaVisual();
  };
}

async function loadReporteKardexCatalogos() {
  if (repKarCatalogosLoaded) return;
  const whSel = $("#repKarWarehouse");
  const catSel = $("#repKarCategoria");
  const usrSel = $("#repKarUsuario");
  const solSel = $("#repKarSolicitante");
  if (!whSel || !catSel || !usrSel || !solSel) return;

  try {
    const [scopeR, catR, usrR] = await Promise.all([
      fetch("/api/reportes/stock-scope", {
        headers: { Authorization: "Bearer " + token },
      }),
      fetch("/api/categorias", {
        headers: { Authorization: "Bearer " + token },
      }),
      fetch("/api/usuarios", {
        headers: { Authorization: "Bearer " + token },
      }),
    ]);
    const scopeJ = await scopeR.json().catch(() => ({}));
    const catRows = await catR.json().catch(() => []);
    const usrRows = await usrR.json().catch(() => []);

    if (scopeR.ok) {
      const rows = Array.isArray(scopeJ.bodegas) ? scopeJ.bodegas : [];
      repKarCanView = Number(scopeJ.can_view_existencias) === 1 || scopeJ.can_view_existencias === true;
      repKarCanAllBodegas = Number(scopeJ.can_all_bodegas) === 1 || scopeJ.can_all_bodegas === true;
      if (!repKarCanView) {
        whSel.innerHTML = `<option value="">Sin acceso</option>`;
        whSel.disabled = true;
      } else if (repKarCanAllBodegas) {
        whSel.innerHTML =
          `<option value="">Todas las bodegas</option>` +
          rows.map((b) => `<option value="${b.id_bodega}">${b.nombre_bodega}</option>`).join("");
        whSel.disabled = false;
      } else {
        whSel.innerHTML = rows.map((b) => `<option value="${b.id_bodega}">${b.nombre_bodega}</option>`).join("");
        if (Number(scopeJ.id_bodega_default || 0)) whSel.value = String(scopeJ.id_bodega_default);
        whSel.disabled = true;
      }
    }

    if (catR.ok) {
      const rows = Array.isArray(catRows) ? catRows : [];
      catSel.innerHTML =
        `<option value="">Todas las categorias</option>` +
        rows.map((c) => `<option value="${c.id_categoria}">${c.nombre_categoria}</option>`).join("");
    }

    if (usrR.ok) {
      const rows = Array.isArray(usrRows) ? usrRows : [];
      const html =
        `<option value="">Todos</option>` +
        rows.map((u) => `<option value="${u.id_user}">${u.full_name || u.username || `#${u.id_user}`}</option>`).join("");
      usrSel.innerHTML = html;
      solSel.innerHTML = html;
    }

    repKarCatalogosLoaded = true;
  } catch (e) { console.error('loadReporteKardexCatalogos:', e); }
}
async function loadReporteKardexSubcategorias() {
  const catId = Number($("#repKarCategoria")?.value || 0);
  const sel = $("#repKarSubcategoria");
  if (!sel) return;
  if (!catId) {
    sel.innerHTML = `<option value="">Todas las subcategorias</option>`;
    return;
  }
  try {
    const r = await fetch(`/api/subcategorias?categoria=${encodeURIComponent(catId)}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) return;
    sel.innerHTML =
      `<option value="">Todas las subcategorias</option>` +
      rows.map((s) => `<option value="${s.id_subcategoria}">${s.nombre_subcategoria}</option>`).join("");
  } catch (e) { console.error('api_subcategorias:', e); }
}

function kardexTipoHtml(tipo) {
  const t = String(tipo || "").toUpperCase();
  if (t === "ENTRADA") return `<span class="kType in">ENTRADA</span>`;
  if (t === "SALIDA" || t === "TRANSFERENCIA") return `<span class="kType out">${t}</span>`;
  return `<span class="kType">${t || "-"}</span>`;
}

function renderKardexResumen(rows) {
  const box = $("#repKarResume");
  if (!box) return;
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    box.innerHTML = `<span class="pill ghost">Sin datos</span>`;
    return;
  }

  const prodSet = new Set(
    list.map((x) => Number(x.id_producto || 0)).filter((n) => Number.isFinite(n) && n > 0)
  );
  if (prodSet.size !== 1) {
    box.innerHTML = `<span class="pill ghost">Filtra un solo producto para ver totales</span>`;
    return;
  }

  let cantidadEntradas = 0;
  let cantidadSalidas = 0;
  let cantidadAjusteEntradas = 0;
  let cantidadAjusteSalidas = 0;
  const transferMap = new Map();
  let stockTotalProducto = null;

  for (const x of list) {
    const tipo = String(x.tipo_movimiento || "").toUpperCase();
    const delta = Number(x.delta_cantidad || 0);
    if (tipo === "ENTRADA") cantidadEntradas += Math.max(0, delta);
    if (tipo === "SALIDA") cantidadSalidas += Math.max(0, -delta);
    if (tipo === "AJUSTE") {
      cantidadAjusteEntradas += Math.max(0, delta);
      cantidadAjusteSalidas += Math.max(0, -delta);
    }
    if (tipo === "TRANSFERENCIA") {
      const key = `${x.id_movimiento || 0}|${x.id_detalle || 0}`;
      const abs = Math.abs(delta);
      if (!transferMap.has(key) || abs > transferMap.get(key)) transferMap.set(key, abs);
    }
    if (stockTotalProducto === null && x.stock_total_producto !== undefined && x.stock_total_producto !== null) {
      stockTotalProducto = Number(x.stock_total_producto || 0);
    }
  }

  const cantidadTransferencias = Array.from(transferMap.values()).reduce((a, b) => a + Number(b || 0), 0);
  if (stockTotalProducto === null) {
    stockTotalProducto = list.reduce((a, x) => a + Number(x.delta_cantidad || 0), 0);
  }

  box.innerHTML = `
    <span class="pill karResume in">Cantidad entradas: <strong>${fmtMoney(cantidadEntradas)}</strong></span>
    <span class="pill karResume out">Cantidad salidas: <strong>${fmtMoney(cantidadSalidas)}</strong></span>
    <span class="pill karResume adjust">Ajustes (+/-): <strong>${fmtMoney(cantidadAjusteEntradas)} / ${fmtMoney(cantidadAjusteSalidas)}</strong></span>
    <span class="pill karResume transfer">Cantidad transferencias: <strong>${fmtMoney(cantidadTransferencias)}</strong></span>
    <span class="pill karResume stock">Total stock: <strong>${fmtMoney(stockTotalProducto)}</strong></span>
  `;
}
async function loadReporteKardex() {
  const tb = $("#repKarList");
  if (!tb) return;
  if (!repKarCanView) {
    tb.innerHTML = `<tr><td colspan="20">Sin permiso para ver kardex.</td></tr>`;
    renderKardexResumen([]);
    return;
  }

  const qs = new URLSearchParams({
    q: ($("#repKarQuery")?.value || "").trim(),
    lote: ($("#repKarLote")?.value || "").trim(),
    from: $("#repKarDateFrom")?.value || "",
    to: $("#repKarDateTo")?.value || "",
    categoria: $("#repKarCategoria")?.value || "",
    subcategoria: $("#repKarSubcategoria")?.value || "",
    tipo: $("#repKarTipo")?.value || "",
    usuario: $("#repKarUsuario")?.value || "",
    solicitante: $("#repKarSolicitante")?.value || "",
    documento: ($("#repKarDocumento")?.value || "").trim(),
    movimiento: $("#repKarMovimiento")?.value || "",
    limit: "3000",
  });
  const warehouse = Number($("#repKarWarehouse")?.value || 0) || "";
  if (warehouse) qs.set("warehouse", String(warehouse));

  tb.innerHTML = `<tr><td colspan="20">Cargando...</td></tr>`;
  try {
    const r = await fetch(`/api/reportes/kardex?${qs.toString()}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) {
      tb.innerHTML = `<tr><td colspan="20">Error al cargar reporte.</td></tr>`;
      renderKardexResumen([]);
      return;
    }
    if (!Array.isArray(rows) || !rows.length) {
      tb.innerHTML = `<tr><td colspan="20">Sin movimientos con esos filtros.</td></tr>`;
      renderKardexResumen([]);
      return;
    }
    renderKardexResumen(rows);

    tb.innerHTML = rows
      .map(
        (x) => `
        <tr>
          <td>${fmtDateOnly(x.fecha || x.creado_en)}</td>
          <td>${String(x.hora || "").slice(0, 8)}</td>
          <td>${kardexTipoHtml(x.tipo_movimiento)}</td>
          <td>${x.id_movimiento ?? ""}</td>
          <td>${x.id_pedido ?? ""}</td>
          <td>${x.bodega_kardex || ""}</td>
          <td>${x.bodega_origen || ""}</td>
          <td>${x.bodega_destino || ""}</td>
          <td>${x.nombre_producto || ""}</td>
          <td>${x.sku || ""}</td>
          <td>${x.nombre_categoria || ""}</td>
          <td>${x.nombre_subcategoria || ""}</td>
          <td>${x.lote || ""}</td>
          <td>${fmtDateOnly(x.fecha_vencimiento)}</td>
          <td>${x.cantidad_entrada ?? 0}</td>
          <td>${x.cantidad_salida ?? 0}</td>
          <td>${fmtMoney(x.costo_unitario)}</td>
          <td>${fmtMoney(x.total_linea)}</td>
          <td>${x.usuario_ingreso || ""}</td>
          <td>${x.solicitante_pedido || ""}</td>
        </tr>
      `
      )
      .join("");
  } catch {
    tb.innerHTML = `<tr><td colspan="20">Error de red.</td></tr>`;
    renderKardexResumen([]);
  }
}

if ($("#repKarCategoria")) {
  $("#repKarCategoria").addEventListener("change", () => {
    loadReporteKardexSubcategorias();
  });
}

if ($("#repKarSearch")) {
  $("#repKarSearch").onclick = async () => {
    await loadReporteKardexCatalogos();
    loadReporteKardex();
  };
}

if ($("#repKarClear")) {
  $("#repKarClear").onclick = () => {
    if ($("#repKarWarehouse")) {
      if (!repKarCanView) $("#repKarWarehouse").value = "";
      else if (repKarCanAllBodegas) $("#repKarWarehouse").value = "";
      else {
        const first = $("#repKarWarehouse").options[0];
        $("#repKarWarehouse").value = first ? first.value : "";
      }
    }
    if ($("#repKarTipo")) $("#repKarTipo").value = "";
    if ($("#repKarQuery")) $("#repKarQuery").value = "";
    if ($("#repKarLote")) $("#repKarLote").value = "";
    if ($("#repKarCategoria")) $("#repKarCategoria").value = "";
    if ($("#repKarSubcategoria")) $("#repKarSubcategoria").innerHTML = `<option value="">Todas las subcategorias</option>`;
    if ($("#repKarUsuario")) $("#repKarUsuario").value = "";
    if ($("#repKarSolicitante")) $("#repKarSolicitante").value = "";
    if ($("#repKarDocumento")) $("#repKarDocumento").value = "";
    if ($("#repKarMovimiento")) $("#repKarMovimiento").value = "";
    if ($("#repKarDateFrom")) $("#repKarDateFrom").value = "";
    if ($("#repKarDateTo")) $("#repKarDateTo").value = "";
    if ($("#repKarList")) $("#repKarList").innerHTML = `<tr><td colspan="20">Usa los filtros y presiona Buscar.</td></tr>`;
    if ($("#repKarResume")) $("#repKarResume").innerHTML = `<span class="pill ghost">Filtra un solo producto para ver totales</span>`;
  };
}

if ($("#repKarQuery")) {
  $("#repKarQuery").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      loadReporteKardex();
    }
  });
}
if ($("#repKarLote")) {
  $("#repKarLote").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      loadReporteKardex();
    }
  });
}

if ($("#repKarDocumento")) {
  $("#repKarDocumento").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      loadReporteKardex();
    }
  });
}

if ($("#repKarMovimiento")) {
  $("#repKarMovimiento").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      loadReporteKardex();
    }
  });
}

bindReportProductPicker(
  "#repExistPickProduct",
  "#repExistQuery",
  "Buscar producto para reporte de existencias",
  loadReporteExistencias
);
bindReportProductPicker(
  "#repDiaPickProduct",
  "#repDiaQuery",
  "Buscar producto para reporte de corte diario",
  loadReporteCorteDiario
);
bindReportProductPicker(
  "#salCountPickProduct",
  "#salCountQuery",
  "Buscar producto para salida por conteo final",
  loadSalidaConteoFinal
);
bindReportProductPicker(
  "#repEntPickProduct",
  "#repEntQuery",
  "Buscar producto para reporte de entradas",
  loadReporteEntradas
);
bindReportProductPicker(
  "#repSalPickProduct",
  "#repSalQuery",
  "Buscar producto para reporte de salidas",
  loadReporteSalidas
);
bindReportProductPicker(
  "#repPedPickProduct",
  "#repPedQuery",
  "Buscar producto para reporte de pedidos",
  loadReportePedidos
);
bindReportProductPicker(
  "#repTrendPickProduct",
  "#repTrendQuery",
  "Buscar producto para tendencia",
  loadReporteTendenciaProducto
);
bindReportProductPicker(
  "#repKarPickProduct",
  "#repKarQuery",
  "Buscar producto para reporte kardex",
  loadReporteKardex
);

async function exportReporteKardexExcel() {
  const tb = $("#repKarList");
  const headRow = document.querySelector("#view-r-transferencias table thead tr");
  if (!tb || !headRow) return;
  const headers = Array.from(headRow.querySelectorAll("th")).map((th) => String(th.textContent || "").trim());
  const bodyRows = Array.from(tb.querySelectorAll("tr"))
    .map((tr) => Array.from(tr.querySelectorAll("td")))
    .filter((cells) => cells.length && !(cells.length === 1 && Number(cells[0].colSpan || 0) > 1))
    .map((cells) => cells.map((td) => String(td.textContent || "").trim()));
  if (!bodyRows.length) {
    showEntToast("No hay datos en la tabla para exportar.", "bad");
    return;
  }
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const logoWarehouseId = Number($("#repKarWarehouse")?.value || 0) || Number(me?.id_warehouse || 0) || null;
  const okStyled = await exportStyledXls({
    headers,
    bodyRows,
    fileName: `reporte_kardex_${stamp}.xls`,
    sheetName: "Kardex",
    reportTitle: "Reporte de Kardex Jardines del Lago",
    logoWarehouseId,
    headerColor: "16A34A",
  });
  if (okStyled) return;
  showEntToast("No se pudo generar el archivo Excel.", "bad");
}

if ($("#repKarExport")) {
  $("#repKarExport").onclick = exportReporteKardexExcel;
}

async function loadReporteAuditoriaSensibles() {
  const tb = $("#repAudList");
  if (!tb) return;
  tb.innerHTML = `<tr><td colspan="8">Cargando...</td></tr>`;
  const qs = new URLSearchParams({
    from: $("#repAudDateFrom")?.value || "",
    to: $("#repAudDateTo")?.value || "",
    action_key: $("#repAudAction")?.value || "",
    q: ($("#repAudQuery")?.value || "").trim(),
    limit: "800",
  });
  for (const [k, v] of Array.from(qs.entries())) {
    if (!String(v || "").trim()) qs.delete(k);
  }
  try {
    const r = await fetch(`/api/reportes/auditoria-sensibles?${qs.toString()}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) {
      tb.innerHTML = `<tr><td colspan="8">${rows?.error || "Error cargando auditoria."}</td></tr>`;
      if ($("#repAudMeta")) $("#repAudMeta").textContent = "Error";
      return;
    }
    if (!Array.isArray(rows) || !rows.length) {
      tb.innerHTML = `<tr><td colspan="8">Sin registros para esos filtros.</td></tr>`;
      if ($("#repAudMeta")) $("#repAudMeta").textContent = "0 registros";
      return;
    }
    tb.innerHTML = rows
      .map((x) => {
        const ts = String(x.creado_en || "");
        const hora = ts ? ts.slice(11, 19) : "";
        const supervisor =
          (x.supervisor_nombre || x.supervisor_usuario)
            ? `${x.supervisor_nombre || ""}${x.supervisor_usuario ? ` (${x.supervisor_usuario})` : ""}`
            : "-";
        const ref = x.reference_type && x.reference_id ? `${x.reference_type} #${x.reference_id}` : "-";
        return `
        <tr>
          <td>${fmtDateOnly(x.creado_en)}</td>
          <td>${hora}</td>
          <td>${x.action_label || x.action_key || ""}</td>
          <td>${x.actor_nombre || x.id_usuario_actor || ""}</td>
          <td>${supervisor}</td>
          <td>${x.approval_method || ""}</td>
          <td>${ref}</td>
          <td>${x.id_bodega_actor || ""}</td>
        </tr>`;
      })
      .join("");
    if ($("#repAudMeta")) $("#repAudMeta").textContent = `${rows.length} registros`;
  } catch {
    tb.innerHTML = `<tr><td colspan="8">Error de red.</td></tr>`;
    if ($("#repAudMeta")) $("#repAudMeta").textContent = "Error de red";
  }
}

if ($("#repAudSearch")) {
  $("#repAudSearch").onclick = loadReporteAuditoriaSensibles;
}
if ($("#repAudClear")) {
  $("#repAudClear").onclick = () => {
    if ($("#repAudDateFrom")) $("#repAudDateFrom").value = "";
    if ($("#repAudDateTo")) $("#repAudDateTo").value = "";
    if ($("#repAudAction")) $("#repAudAction").value = "";
    if ($("#repAudQuery")) $("#repAudQuery").value = "";
    if ($("#repAudList")) $("#repAudList").innerHTML = `<tr><td colspan="8">Usa los filtros y presiona Buscar.</td></tr>`;
    if ($("#repAudMeta")) $("#repAudMeta").textContent = "0 registros";
  };
}
if ($("#repAudQuery")) {
  $("#repAudQuery").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      loadReporteAuditoriaSensibles();
    }
  });
}

function renderEntradas() {
  const tb = $("#entList");
  const stickerBtn = $("#entStickerPrint");
  if (!tb) return;
  if (!entList.length) {
    tb.innerHTML = `<tr><td colspan="7">Sin productos agregados.</td></tr>`;
    if ($("#entSave")) $("#entSave").disabled = true;
    if (stickerBtn) {
      stickerBtn.disabled = true;
      stickerBtn.style.display = "none";
    }
    return;
  }
  if ($("#entSave")) $("#entSave").disabled = false;
  if (stickerBtn) {
    const totalStickers = calcEntradaStickerTotal(entList);
    stickerBtn.disabled = totalStickers <= 0;
    stickerBtn.style.display = "";
    stickerBtn.textContent = `Generar stickers (${totalStickers})`;
  }
  tb.innerHTML = entList.map((x, i) => {
    const isEdit = entEditingIdx === i;
    return `
    <tr>
      <td>${x.producto}</td>
      <td><input class="gridInput" data-lote="${i}" value="${x.lote || ""}" ${isEdit ? "" : "disabled"} /></td>
      <td><input class="gridInput" data-cad="${i}" type="date" value="${x.caducidad || ""}" ${isEdit ? "" : "disabled"} /></td>
      <td><input class="gridInput" data-qty="${i}" type="number" min="0" step="1" value="${x.cantidad}" ${isEdit ? "" : "disabled"} /></td>
      <td><input class="gridInput" data-price="${i}" type="number" min="0" step="1" value="${x.precio}" ${isEdit ? "" : "disabled"} /></td>
      <td>${money(x.total)}</td>
      <td>
        <div class="gridActions">
          <button class="iconBtn edit" data-edit="${i}" title="${isEdit ? "Guardar" : "Editar"}">
            ${
              isEdit
                ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l4 4 10-10" /></svg>'
                : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M13 7l4 4" /></svg>'
            }
          </button>
          <button class="iconBtn del" data-del="${i}" title="Eliminar">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7l-10 10" /></svg>
          </button>
        </div>
      </td>
    </tr>
  `;
  }).join("");

  tb.querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = () => {
      const idx = Number(b.dataset.del);
      entList.splice(idx, 1);
      renderEntradas();
    };
  });

  tb.querySelectorAll("[data-edit]").forEach((b) => {
    b.onclick = () => {
      const idx = Number(b.dataset.edit);
      entEditingIdx = entEditingIdx === idx ? null : idx;
      renderEntradas();
    };
  });

  tb.querySelectorAll("[data-lote]").forEach((inp) => {
    inp.oninput = () => {
      if (entEditingIdx === null) return;
      const idx = Number(inp.dataset.lote);
      const it = entList[idx];
      if (!it) return;
      it.lote = inp.value;
    };
  });

  tb.querySelectorAll("[data-cad]").forEach((inp) => {
    inp.oninput = () => {
      if (entEditingIdx === null) return;
      const idx = Number(inp.dataset.cad);
      const it = entList[idx];
      if (!it) return;
      it.caducidad = inp.value;
    };
  });

  tb.querySelectorAll("[data-qty]").forEach((inp) => {
    inp.oninput = () => {
      if (entEditingIdx === null) return;
      const idx = Number(inp.dataset.qty);
      const it = entList[idx];
      if (!it) return;
      it.cantidad = Number(inp.value || 0);
      it.total = it.cantidad * it.precio;
      renderEntradas();
    };
  });

  tb.querySelectorAll("[data-price]").forEach((inp) => {
    inp.oninput = () => {
      if (entEditingIdx === null) return;
      const idx = Number(inp.dataset.price);
      const it = entList[idx];
      if (!it) return;
      it.precio = Number(inp.value || 0);
      it.total = it.cantidad * it.precio;
      renderEntradas();
    };
  });

  initDatePickers(tb);
}

function stickerCountForCantidad(cantidad) {
  const n = Number(cantidad || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n);
}

function calcEntradaStickerTotal(rows = entList) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  return rows.reduce((acc, x) => acc + stickerCountForCantidad(x?.cantidad), 0);
}

function buildEntradaStickersFromCart() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const fechaEntradaBase = $("#entFecha")?.value || `${yyyy}-${mm}-${dd}`;
  const fechaEntrada = fmtDateOnly(fechaEntradaBase) || fechaEntradaBase;
  const stickers = [];

  entList.forEach((line) => {
    const count = stickerCountForCantidad(line?.cantidad);
    const producto = (line?.producto || "").trim() || "Producto";
    const fechaVenc = fmtDateOnly(line?.caducidad || "") || "N/D";
    const lote = String(line?.lote || "").trim() || "N/D";
    const codigo = String(line?.sku || "").trim() || String(line?.id_producto || "").trim() || "N/D";
    for (let i = 0; i < count; i++) {
      stickers.push({
        producto,
        fechaEntrada,
        fechaVenc,
        codigo,
        lote,
      });
    }
  });

  return stickers;
}

function openEntradaStickerPreview() {
  if (!entList.length) {
    showEntToast("No hay productos en el carrito de entradas.", "bad");
    return;
  }

  const stickers = buildEntradaStickersFromCart();
  if (!stickers.length) {
    showEntToast("No hay stickers para generar.", "bad");
    return;
  }

  const maxStickers = 800;
  if (stickers.length > maxStickers) {
    showEntToast(`Demasiados stickers (${stickers.length}). Reduce la cantidad o genera en lotes.`, "bad");
    return;
  }

  const cardsHtml = stickers
    .map(
      (s) => `
      <div class="sticker">
        <div class="stickerName">${escapeHtml(s.producto)}</div>
        <div class="stickerMeta"><b>F. Entrada:</b> ${escapeHtml(s.fechaEntrada)}</div>
        <div class="stickerMeta"><b>Vence:</b> ${escapeHtml(s.fechaVenc)}</div>
        <div class="stickerMeta"><b>Codigo:</b> ${escapeHtml(s.codigo)}</div>
        <div class="stickerMeta"><b>Lote:</b> ${escapeHtml(s.lote)}</div>
      </div>
    `
    )
    .join("");

  const html = `<!doctype html><html lang="es"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Stickers de Entradas</title>
<style>
  *{ box-sizing:border-box; }
  body{ margin:0; font-family:Arial,sans-serif; background:#f4f7fb; color:#0f172a; }
  .toolbar{ position:sticky; top:0; z-index:5; display:flex; justify-content:space-between; align-items:center; gap:10px; background:#0f172a; color:#fff; padding:10px 14px; }
  .toolbar .meta{ font-size:13px; opacity:.92; }
  .toolbar .actions{ display:flex; gap:8px; }
  .toolbar button{ border:1px solid #334155; background:#1e293b; color:#fff; border-radius:8px; padding:7px 12px; font-size:13px; cursor:pointer; }
  .sheet{ padding:10mm; display:grid; grid-template-columns:repeat(auto-fill, minmax(48mm, 1fr)); gap:4mm; align-content:start; }
  .sticker{ width:48mm; min-height:30mm; border:1px dashed #64748b; border-radius:2mm; background:#fff; padding:2.5mm; display:flex; flex-direction:column; gap:1mm; page-break-inside:avoid; }
  .stickerName{ font-size:11px; font-weight:800; text-align:center; line-height:1.2; word-break:break-word; margin-bottom:1mm; }
  .stickerMeta{ font-size:9px; line-height:1.2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  @media print{
    @page{ size:A4 portrait; margin:8mm; }
    body{ background:#fff; }
    .toolbar{ display:none !important; }
    .sheet{ padding:0; gap:3mm; }
    .sticker{ border:1px solid #cbd5e1; }
  }
</style>
</head><body>
  <div class="toolbar">
    <div class="meta">Stickers: <b>${stickers.length}</b></div>
    <div class="actions">
      <button type="button" onclick="window.print()">Imprimir</button>
      <button type="button" onclick="window.close()">Cerrar</button>
    </div>
  </div>
  <div class="sheet">${cardsHtml}</div>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) {
    showEntToast("El navegador bloqueo la ventana de impresion.", "bad");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

if ($("#entStickerPrint")) {
  $("#entStickerPrint").onclick = () => {
    openEntradaStickerPreview();
  };
}

if ($("#entAdd")) {
  const clearLineFields = () => {
      $("#entProducto").value = "";
      $("#entLote").value = "";
    clearDateInputValue($("#entCaducidad"));
    $("#entCantidad").value = "";
    $("#entPrecio").value = "";
    if ($("#entStock")) $("#entStock").value = "";
    setEntradaPrecioSugerido(0);
    updateEntradaTotal();
    $("#entProducto").dataset.sku = "";
  };

  $("#entAdd").onclick = () => {
    const producto = $("#entProducto").value.trim();
    const lote = $("#entLote").value.trim();
    const caducidad = $("#entCaducidad").value;
    const cantidad = Number($("#entCantidad").value);
    const precio = Number($("#entPrecio").value);
    const id_producto = $("#entProducto").dataset.id ? Number($("#entProducto").dataset.id) : null;
    const sku = ($("#entProducto").dataset.sku || "").trim();

    if (!producto) {
      showEntToast("Selecciona el producto desde el buscador.", "bad");
      markError($("#entProducto"));
      return;
    }
    if (!lote) {
      showEntToast("El lote es obligatorio.", "bad");
      markError($("#entLote"));
      return;
    }
    if (!caducidad) {
      showEntToast("La fecha de caducidad es obligatoria.", "bad");
      markError($("#entCaducidad"));
      return;
    }
    if (!cantidad || cantidad <= 0) {
      showEntToast("La cantidad es obligatoria.", "bad");
      markError($("#entCantidad"));
      return;
    }
    if (!precio || precio <= 0) {
      showEntToast("El precio de compra es obligatorio.", "bad");
      markError($("#entPrecio"));
      return;
    }
    if (!id_producto) {
      showEntToast("Selecciona el producto desde el buscador.", "bad");
      return;
    }
    if (isExpired(caducidad)) {
      showEntToast("La fecha de caducidad ya vencio. No se puede agregar.", "bad");
      return;
    }
    const total = cantidad * precio;
    entList.push({
      producto,
      id_producto,
      sku,
      lote,
      caducidad,
      cantidad,
      precio,
      total,
    });

    // Solo limpiamos los campos del detalle. Documento, proveedor y demas
    // datos del encabezado se mantienen para poder agregar varios productos.
    clearLineFields();
    $("#entProducto").dataset.id = "";
    renderEntradas();
  };
}

if ($("#entClear")) {
  $("#entClear").onclick = async () => {
    if (!entList.length) return;
    if (!(await uiConfirm("Vaciar la lista de productos?", "Confirmar vaciado"))) return;
    entList.splice(0, entList.length);
    entEditingIdx = null;
    renderEntradas();
    showEntToast("Lista vaciada correctamente.", "ok");
  };
}

if ($("#entSave")) {
  const detectEntradaGuardadaReciente = async (noDocumento) => {
    const doc = String(noDocumento || "").trim();
    if (!doc) return null;
    try {
      const qs = new URLSearchParams({ no_documento: doc });
      const rr = await fetch(`/api/entradas/existe-documento?${qs.toString()}`, {
        headers: { Authorization: "Bearer " + token },
      });
      const jj = await rr.json().catch(() => ({}));
      if (!rr.ok) return null;
      if (!jj?.exists || !jj?.id_movimiento) return null;
      return { id_movimiento: Number(jj.id_movimiento || 0), creado_en: jj.creado_en || null };
    } catch {
      return null;
    }
  };

  $("#entSave").onclick = async () => {
    if (entSaveInFlight) return;
    if (!entList.length) return;
    const id_motivo = Number($("#entMotivo")?.value || 0);
    if (!id_motivo) {
      showEntToast("Selecciona un motivo.", "bad");
      markError($("#entMotivo"));
      return;
    }
    const id_proveedor = Number($("#entProveedor")?.value || 0);
    if (!id_proveedor) {
      showEntToast("Selecciona un proveedor.", "bad");
      markError($("#entProveedor"));
      return;
    }
    const no_documento = $("#entDocumento")?.value?.trim() || "";
    if (!no_documento) {
      showEntToast("Ingresa el numero de documento.", "bad");
      markError($("#entDocumento"));
      return;
    }
    setFechaHoraActual();
    const payload = {
      id_motivo,
      id_proveedor,
      no_documento,
      observaciones: $("#entObservacion")?.value?.trim() || null,
      pagado: $("#entPagado")?.value || null,
      lines: entList,
    };

    entSaveInFlight = true;
    const entSaveBtn = $("#entSave");
    if (entSaveBtn) entSaveBtn.disabled = true;
    showSavingProgressToast("entrada");
    /* Mobile saving indicator */
    if (entSaveBtn) entSaveBtn.classList.add('is-saving');
    try {
      let r = await fetch("/api/entradas", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(payload),
      });
      let j = await r.json().catch(() => ({}));
      if (!r.ok && (j.code === "SENSITIVE_APPROVAL_REQUIRED" || j.code === "SUPERVISOR_PIN_REQUIRED")) {
        const ap = await promptSensitiveApproval("ajuste manual de entrada");
        if (!ap) {
          showEntToast("Operacion cancelada: falta validacion de supervisor.", "bad");
          return;
        }
        r = await fetch("/api/entradas", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify({ ...payload, ...ap }),
        });
        j = await r.json().catch(() => ({}));
      }
      if (!r.ok) {
        if (r.status === 413) {
          showEntToast("Carga demasiado grande. Intenta guardar en bloques mas pequenos.", "bad");
          return;
        }
        showEntToast(j.error || "Error guardando entrada.", "bad");
        return;
      }
      showSupervisorAuthBadge(j.sensitive_approval);
      entList.splice(0, entList.length);
      entEditingIdx = null;
      renderEntradas();
      clearSectionTextboxesExcept("#view-entradas", ["#entBodega", "#entFecha", "#entHora"]);
      setFechaHoraActual();
      loadBodegaUsuario();
      if ($("#entProducto")) {
        $("#entProducto").dataset.id = "";
        $("#entProducto").dataset.sku = "";
      }
      showEntToast(`Productos guardados. Entrada #${j.id_movimiento}`, "ok");
    } catch {
      const hit = await detectEntradaGuardadaReciente(no_documento);
      if (hit?.id_movimiento) {
        entList.splice(0, entList.length);
        entEditingIdx = null;
        renderEntradas();
        clearSectionTextboxesExcept("#view-entradas", ["#entBodega", "#entFecha", "#entHora"]);
        setFechaHoraActual();
        loadBodegaUsuario();
        if ($("#entProducto")) {
          $("#entProducto").dataset.id = "";
          $("#entProducto").dataset.sku = "";
        }
        showEntToast(`Productos guardados. Entrada #${hit.id_movimiento}. La respuesta tardo y se perdio la conexion.`, "ok");
        return;
      }
      showEntToast("Error de red. Si la carga era grande, verifica en Reporte de Entradas antes de reintentar.", "bad");
    } finally {
      /* Mobile saving indicator */
      const entBtn = document.querySelector('#entSave');
      if (entBtn) entBtn.classList.remove('is-saving');
      entSaveInFlight = false;
      renderEntradas();
    }
  };
}

function renderSalidas() {
  const tb = $("#salList");
  if (!tb) return;
  if (!salList.length) {
    tb.innerHTML = `<tr><td colspan="5">Sin productos agregados.</td></tr>`;
    if ($("#salSave")) $("#salSave").disabled = true;
    return;
  }
  if ($("#salSave")) $("#salSave").disabled = false;
  tb.innerHTML = salList
    .map(
      (x, i) => `
    <tr>
      <td>${x.producto}</td>
      <td><input class="gridInput" data-sqty="${i}" type="number" min="0" step="1" value="${x.cantidad}" /></td>
      <td><input class="gridInput" data-sprice="${i}" type="number" min="0" step="0.01" value="${Number(x.precio_salida || 0)}" /></td>
      <td><input class="gridInput" data-sobs="${i}" value="${x.observacion_linea || ""}" /></td>
      <td>
        <div class="gridActions">
          <button class="iconBtn del" data-sdel="${i}" title="Eliminar">X</button>
        </div>
      </td>
    </tr>
  `
    )
    .join("");

  tb.querySelectorAll("[data-sdel]").forEach((b) => {
    b.onclick = () => {
      const idx = Number(b.dataset.sdel);
      salList.splice(idx, 1);
      renderSalidas();
    };
  });

  tb.querySelectorAll("[data-sqty]").forEach((inp) => {
    inp.oninput = () => {
      const idx = Number(inp.dataset.sqty);
      const it = salList[idx];
      if (!it) return;
      it.cantidad = Number(inp.value || 0);
    };
  });

  tb.querySelectorAll("[data-sobs]").forEach((inp) => {
    inp.oninput = () => {
      const idx = Number(inp.dataset.sobs);
      const it = salList[idx];
      if (!it) return;
      it.observacion_linea = inp.value || "";
    };
  });

  tb.querySelectorAll("[data-sprice]").forEach((inp) => {
    inp.oninput = () => {
      const idx = Number(inp.dataset.sprice);
      const it = salList[idx];
      if (!it) return;
      it.precio_salida = Number(inp.value || 0);
    };
  });
}

if ($("#salAdd")) {
  const clearSalLineFields = () => {
    $("#salProducto").value = "";
    $("#salCantidad").value = "";
    $("#salPrecio").value = "";
    $("#salLineaObs").value = "";
    $("#salStock").value = "";
    $("#salProducto").dataset.id = "";
  };

  $("#salAdd").onclick = () => {
    const producto = $("#salProducto")?.value?.trim() || "";
    const id_producto = Number($("#salProducto")?.dataset.id || 0);
    const cantidad = Number($("#salCantidad")?.value || 0);
    const stockActual = Number($("#salStock")?.value || 0);
    const precio_salida = Number($("#salPrecio")?.value || 0);
    const observacion_linea = $("#salLineaObs")?.value?.trim() || "";
    const yaAgregado = salList
      .filter((x) => Number(x.id_producto) === id_producto)
      .reduce((acc, x) => acc + Number(x.cantidad || 0), 0);

    if (!producto || !id_producto) {
      showEntToast("Selecciona el producto desde el buscador.", "bad");
      markError($("#salProducto"));
      return;
    }
    if (!cantidad || cantidad <= 0) {
      showEntToast("Ingresa una cantidad valida.", "bad");
      markError($("#salCantidad"));
      return;
    }
    if (cantidad + yaAgregado > stockActual) {
      showEntToast("La cantidad supera el stock disponible.", "bad");
      markError($("#salCantidad"));
      return;
    }
    if (salPrecioSalidaObligatorio && precio_salida <= 0) {
      showEntToast("El precio de salida es obligatorio y debe ser mayor a 0.", "bad");
      markError($("#salPrecio"));
      return;
    }

    salList.push({
      producto,
      id_producto,
      cantidad,
      precio_salida: precio_salida > 0 ? precio_salida : 0,
      observacion_linea,
    });
    clearSalLineFields();
    renderSalidas();
  };
}

if ($("#salClear")) {
  $("#salClear").onclick = async () => {
    if (!salList.length) return;
    if (!(await uiConfirm("Vaciar la lista de salidas?", "Confirmar vaciado"))) return;
    salList.splice(0, salList.length);
    renderSalidas();
    showEntToast("Lista vaciada correctamente.", "ok");
  };
}

if ($("#salSave")) {
  const detectSalidaGuardadaReciente = async ({ id_bodega_destino, observaciones }) => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const ymd = `${yyyy}-${mm}-${dd}`;
    try {
      const qs = new URLSearchParams({ from: ymd, to: ymd, limit: "200" });
      const rr = await fetch(`/api/reportes/salidas?${qs.toString()}`, {
        headers: { Authorization: "Bearer " + token },
      });
      const rows = await rr.json().catch(() => []);
      if (!rr.ok || !Array.isArray(rows) || !rows.length) return null;
      const actorName = String(me?.full_name || "").trim().toLowerCase();
      const obsNorm = String(observaciones || "").trim().toLowerCase();
      const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
      return (
        rows.find((x) => {
          const idDst = Number(x?.id_bodega_destino || 0);
          if (Number(id_bodega_destino || 0) > 0 && idDst !== Number(id_bodega_destino || 0)) return false;
          const rowObs = String(x?.observaciones || "").trim().toLowerCase();
          if (obsNorm && rowObs !== obsNorm) return false;
          const creator = String(x?.usuario_creador || "").trim().toLowerCase();
          if (actorName && creator && creator !== actorName) return false;
          const created = new Date(x?.creado_en || "").getTime();
          if (!Number.isFinite(created)) return false;
          return created >= tenMinutesAgo;
        }) || null
      );
    } catch {
      return null;
    }
  };

  $("#salSave").onclick = async () => {
    if (salSaveInFlight) return;
    if (!salList.length) return;
    const id_bodega_destino = Number($("#salDestino")?.value || 0);
    if (!id_bodega_destino) {
      showEntToast("Selecciona la bodega destino.", "bad");
      markError($("#salDestino"));
      return;
    }
    const id_motivo = Number($("#salMotivo")?.value || 0);
    if (!id_motivo) {
      showEntToast("Selecciona un motivo.", "bad");
      markError($("#salMotivo"));
      return;
    }
    if (isVentasNilasDestinoSelected()) {
      const obsNoCheck = ($("#salObservacion")?.value || "").trim();
      if (!obsNoCheck) {
        showEntToast("No Check es obligatorio para destino Ventas Nilas.", "bad");
        markError($("#salObservacion"));
        return;
      }
    }

    const invalid = salList.find((x) => {
      if (!x.id_producto || Number(x.cantidad || 0) <= 0) return true;
      if (salPrecioSalidaObligatorio && Number(x.precio_salida || 0) <= 0) return true;
      return false;
    });
    if (invalid) {
      showEntToast("Hay lineas con cantidad invalida.", "bad");
      return;
    }

    const payload = {
      id_bodega_destino,
      id_motivo,
      observaciones: $("#salObservacion")?.value?.trim() || null,
      lines: salList.map((x) => ({
        id_producto: x.id_producto,
        cantidad: Number(x.cantidad || 0),
        precio_salida: Number(x.precio_salida || 0),
        observacion_linea: x.observacion_linea || null,
      })),
    };

    salSaveInFlight = true;
    const salSaveBtn = $("#salSave");
    if (salSaveBtn) salSaveBtn.disabled = true;
    showSavingProgressToast("salida");
    /* Mobile saving indicator */
    if (salSaveBtn) salSaveBtn.classList.add('is-saving');
    try {
      let r = await fetch("/api/salidas", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(payload),
      });
      let j = await r.json().catch(() => ({}));
      if (!r.ok && (j.code === "SENSITIVE_APPROVAL_REQUIRED" || j.code === "SUPERVISOR_PIN_REQUIRED")) {
        const ap = await promptSensitiveApproval("ajuste manual de salida");
        if (!ap) {
          showEntToast("Operacion cancelada: falta validacion de supervisor.", "bad");
          return;
        }
        r = await fetch("/api/salidas", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify({ ...payload, ...ap }),
        });
        j = await r.json().catch(() => ({}));
      }
      if (!r.ok) {
        if (r.status === 413) {
          showEntToast("Carga demasiado grande. Intenta guardar en bloques mas pequenos.", "bad");
          return;
        }
        showEntToast(j.error || "Error guardando salida.", "bad");
        return;
      }
      showSupervisorAuthBadge(j.sensitive_approval);
      salList.splice(0, salList.length);
      renderSalidas();
      clearSectionTextboxesExcept("#view-salidas", ["#salBodega", "#salFecha", "#salHora"]);
      setFechaHoraActual();
      loadBodegaUsuarioSalida();
      applySalidaDestinoSpecialRules();
      if ($("#salProducto")) $("#salProducto").dataset.id = "";
      $("#salDestino").value = "";
      $("#salTipoMov").value = "";
      applyConfiguredDefaultSalidaDestino();
      applyDefaultSalidaDestinoForNilasUser();
      motivosSalidaLoaded = false;
      loadMotivosSalida();
      showEntToast(`${j.tipo_movimiento || "SALIDA"} guardada #${j.id_movimiento}`, "ok");
    } catch {
      const hit = await detectSalidaGuardadaReciente({
        id_bodega_destino,
        observaciones: $("#salObservacion")?.value?.trim() || null,
      });
      if (hit?.id_movimiento) {
        salList.splice(0, salList.length);
        renderSalidas();
        clearSectionTextboxesExcept("#view-salidas", ["#salBodega", "#salFecha", "#salHora"]);
        setFechaHoraActual();
        loadBodegaUsuarioSalida();
        applySalidaDestinoSpecialRules();
        if ($("#salProducto")) $("#salProducto").dataset.id = "";
        $("#salDestino").value = "";
        $("#salTipoMov").value = "";
        applyConfiguredDefaultSalidaDestino();
        applyDefaultSalidaDestinoForNilasUser();
        motivosSalidaLoaded = false;
        loadMotivosSalida();
        showEntToast(`Salida guardada #${hit.id_movimiento}. La respuesta tardo y se perdio la conexion.`, "ok");
        return;
      }
      showEntToast("Error de red. Si la carga era grande, verifica en Reporte de Salidas antes de reintentar.", "bad");
    } finally {
      /* Mobile saving indicator */
      const salBtn = document.querySelector('#salSave');
      if (salBtn) salBtn.classList.remove('is-saving');
      salSaveInFlight = false;
      renderSalidas();
    }
  };
}

let ajList = [];
let ajustesMotivosLoaded = false;
let ajDireccionCurrent = "ENTRADA";
let ajUpdatingDireccion = false;
let ajStockActual = null;

function getAjusteMeta(direccion) {
  const isEntrada = String(direccion || "ENTRADA") === "ENTRADA";
  return isEntrada
    ? {
        isEntrada: true,
        sign: "+",
        flowTitle: "Ajuste de entrada (+): suma unidades al stock",
        flowDesc: "Usa este tipo cuando recibes producto fisico al inventario. Requiere lote para trazabilidad.",
        qtyHead: "Cantidad (+)",
        addLabel: "Agregar linea de entrada",
        saveLabel: "Guardar ajuste de entrada",
        helpType: "Entrada (+)",
        helpStep3: "Revisa el impacto total y presiona Guardar ajuste de entrada.",
      }
    : {
        isEntrada: false,
        sign: "-",
        flowTitle: "Ajuste de salida (-): resta unidades del stock",
        flowDesc: "Usa este tipo cuando necesitas rebajar existencia por perdida, dano o correccion de inventario.",
        qtyHead: "Cantidad (-)",
        addLabel: "Agregar linea de salida",
        saveLabel: "Guardar ajuste de salida",
        helpType: "Salida (-)",
        helpStep3: "Revisa el impacto total y presiona Guardar ajuste de salida.",
      };
}

function updateAjusteImpactPreview() {
  const cantidad = Number($("#ajCantidad")?.value || 0);
  const meta = getAjusteMeta($("#ajDireccion")?.value || ajDireccionCurrent);
  const text = `Impacto por linea: ${meta.sign}${cantidad > 0 ? cantidad : 0} unidades al stock.`;
  const impact = $("#ajImpactBox");
  if (impact) {
    impact.textContent = text;
    impact.classList.remove("is-entrada", "is-salida");
    impact.classList.add(meta.isEntrada ? "is-entrada" : "is-salida");
  }
  updateAjusteStockPreview();
}

function getAjusteWarehouseId() {
  return Number($("#ajWarehouse")?.value || 0) || Number(me?.id_warehouse || 0) || null;
}

function updateAjusteStockPreview() {
  const stockInput = $("#ajStockActual");
  const proyectadoInput = $("#ajStockProyectado");
  if (!stockInput || !proyectadoInput) return;

  const id = Number($("#ajProducto")?.dataset.id || 0);
  if (!id || ajStockActual === null) {
    stockInput.value = "";
    proyectadoInput.value = "";
    return;
  }

  const stockBase = Number(ajStockActual || 0);
  const cantidad = Math.max(0, Number($("#ajCantidad")?.value || 0));
  const isEntrada = String($("#ajDireccion")?.value || "ENTRADA") === "ENTRADA";
  const proyectado = isEntrada ? stockBase + cantidad : stockBase - cantidad;

  stockInput.value = fmtQty(stockBase);
  proyectadoInput.value = fmtQty(proyectado);
}

async function loadAjusteStockActual() {
  const id = Number($("#ajProducto")?.dataset.id || 0);
  if (!id) {
    ajStockActual = null;
    updateAjusteStockPreview();
    return;
  }

  const wh = getAjusteWarehouseId();
  const qs = wh ? `?warehouse=${encodeURIComponent(wh)}` : "";
  try {
    const r = await fetch(`/api/productos/${id}/stock${qs}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return;
    ajStockActual = Number(j.stock || 0);
    updateAjusteStockPreview();
  } catch (e) { console.error('loadAjusteStockActual:', e); }
}

function updateAjusteUiHints() {
  const direccion = String($("#ajDireccion")?.value || ajDireccionCurrent || "ENTRADA");
  const meta = getAjusteMeta(direccion);

  const flowCard = $("#ajFlowCard");
  const flowTitle = $("#ajFlowTitle");
  const flowDesc = $("#ajFlowDesc");
  if (flowTitle) flowTitle.textContent = meta.flowTitle;
  if (flowDesc) flowDesc.textContent = meta.flowDesc;
  if (flowCard) {
    flowCard.classList.remove("is-entrada", "is-salida");
    flowCard.classList.add(meta.isEntrada ? "is-entrada" : "is-salida");
  }

  if ($("#ajQtyHead")) $("#ajQtyHead").textContent = meta.qtyHead;
  if ($("#ajAdd")) $("#ajAdd").textContent = meta.addLabel;
  if ($("#ajSave")) $("#ajSave").textContent = meta.saveLabel;
  if ($("#ajMiniHelpType")) $("#ajMiniHelpType").textContent = meta.helpType;
  if ($("#ajMiniHelpStep3")) $("#ajMiniHelpStep3").innerHTML = `<strong>3.</strong> ${meta.helpStep3}`;

  ["#ajLoteWrap", "#ajCaducidadWrap", "#ajCostoWrap"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.classList.toggle("hidden", !meta.isEntrada);
  });

  if ($("#ajLote")) $("#ajLote").disabled = !meta.isEntrada;
  if ($("#ajCaducidad")) $("#ajCaducidad").disabled = !meta.isEntrada;
  if ($("#ajCosto")) $("#ajCosto").disabled = !meta.isEntrada;

  if (!meta.isEntrada) {
    if ($("#ajLote")) $("#ajLote").value = "";
    if ($("#ajCaducidad")) $("#ajCaducidad").value = "";
    if ($("#ajCosto")) $("#ajCosto").value = "";
  }

  updateAjusteImpactPreview();
}

function renderAjustes() {
  const tb = $("#ajList");
  if (!tb) return;

  const direccion = String($("#ajDireccion")?.value || ajDireccionCurrent || "ENTRADA");
  const meta = getAjusteMeta(direccion);
  const totalUnidades = ajList.reduce((acc, x) => acc + Number(x.cantidad || 0), 0);

  const resume = $("#ajResume");
  if (resume) {
    resume.classList.add("ajResume");
    if (!ajList.length) {
      resume.textContent = "Sin lineas agregadas.";
    } else {
      resume.textContent = `${ajList.length} linea(s) lista(s). Impacto total estimado: ${meta.sign}${totalUnidades} unidades.`;
    }
  }

  if (!ajList.length) {
    tb.innerHTML = `<tr><td colspan="7">Sin lineas de ajuste.</td></tr>`;
    if ($("#ajSave")) $("#ajSave").disabled = true;
    return;
  }

  if ($("#ajSave")) $("#ajSave").disabled = false;
  tb.innerHTML = ajList
    .map(
      (x, i) => `
      <tr>
        <td>${x.producto || ""}</td>
        <td>${x.lote || ""}</td>
        <td>${x.caducidad || ""}</td>
        <td class="ajQty ${meta.isEntrada ? "entrada" : "salida"}">${meta.sign}${x.cantidad}</td>
        <td>${fmtMoney(x.costo_unitario || 0)}</td>
        <td>${x.observacion_linea || ""}</td>
        <td><button class="iconBtn del" data-ajdel="${i}" title="Eliminar">X</button></td>
      </tr>
    `
    )
    .join("");

  tb.querySelectorAll("[data-ajdel]").forEach((b) => {
    b.onclick = () => {
      const idx = Number(b.dataset.ajdel || -1);
      if (idx < 0) return;
      ajList.splice(idx, 1);
      renderAjustes();
    };
  });
}

async function loadAjustesMotivos() {
  if (ajustesMotivosLoaded) return;
  const sel = $("#ajMotivo");
  if (!sel) return;
  try {
    const r = await fetch("/api/motivos?tipo=AJUSTE", {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) return;
    sel.innerHTML =
      `<option value="">Seleccione motivo AJUSTE</option>` +
      (rows || [])
        .map((m) => `<option value="${m.id_motivo}">${m.nombre_motivo || `Motivo #${m.id_motivo}`}</option>`)
        .join("");
    ajustesMotivosLoaded = true;
  } catch (e) { console.error('loadCorrelativoSalidaDocumento:', e); }
}

async function loadAjustesWarehouseFilter(force = false) {
  const sel = $("#ajWarehouse");
  if (!sel) return;
  if (ajWarehouseLoaded && !force) return;
  try {
    const r = await fetch("/api/reportes/stock-scope", {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return;
    const rows = Array.isArray(j.bodegas) ? j.bodegas : [];
    ajCanAllBodegas = Number(j.can_all_bodegas) === 1 || j.can_all_bodegas === true;
    if (ajCanAllBodegas) {
      sel.innerHTML =
        `<option value="">Tu bodega por defecto</option>` +
        rows.map((b) => `<option value="${b.id_bodega}">${escapeHtml(b.nombre_bodega || "")}</option>`).join("");
      sel.disabled = false;
      if (Number(j.id_bodega_default || 0) > 0) sel.value = String(j.id_bodega_default);
    } else {
      sel.innerHTML = rows.map((b) => `<option value="${b.id_bodega}">${escapeHtml(b.nombre_bodega || "")}</option>`).join("");
      if (Number(j.id_bodega_default || 0) > 0) sel.value = String(j.id_bodega_default);
      sel.disabled = true;
    }
    ajWarehouseLoaded = true;
    await loadAjusteStockActual();
  } catch (e) { console.error('loadAjustesWarehouseFilter:', e); }
}

if ($("#ajSearchBtn")) {
  $("#ajSearchBtn").onclick = async () => {
    const input = $("#ajProducto");
    await uiItemSearch({
      title: "Buscar producto para ajuste",
      initialQuery: input?.value || "",
      getWarehouseId: () => Number($("#ajWarehouse")?.value || 0) || Number(me?.id_warehouse || 0) || null,
      onSelect: async (p) => {
        if (!input) return;
        input.value = p.nombre_producto || "";
        input.dataset.id = String(p.id_producto || "");
        input.dataset.sku = p.sku || "";
        await loadAjusteStockActual();
      },
    });
  };
}
if ($("#ajProducto")) {
  $("#ajProducto").addEventListener("input", () => {
    $("#ajProducto").dataset.id = "";
    $("#ajProducto").dataset.sku = "";
    ajStockActual = null;
    updateAjusteStockPreview();
  });
  $("#ajProducto").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    $("#ajSearchBtn")?.click();
  });
}

if ($("#ajWarehouse")) {
  $("#ajWarehouse").addEventListener("change", () => {
    loadAjusteStockActual();
  });
}

if ($("#ajCantidad")) {
  $("#ajCantidad").addEventListener("input", () => {
    updateAjusteImpactPreview();
  });
}

if ($("#ajDireccion")) {
  ajDireccionCurrent = String($("#ajDireccion")?.value || "ENTRADA");
  $("#ajDireccion").addEventListener("change", async () => {
    if (ajUpdatingDireccion) return;

    const sel = $("#ajDireccion");
    if (!sel) return;
    const nextDireccion = String(sel.value || "ENTRADA");

    if (ajList.length && nextDireccion !== ajDireccionCurrent) {
      const ok = await uiConfirm(
        "Cambiar el tipo de ajuste vaciara las lineas cargadas para evitar errores. Deseas continuar?",
        "Cambiar tipo de ajuste"
      );
      if (!ok) {
        ajUpdatingDireccion = true;
        sel.value = ajDireccionCurrent;
        ajUpdatingDireccion = false;
        updateAjusteUiHints();
        return;
      }
      ajList.splice(0, ajList.length);
    }

    ajDireccionCurrent = nextDireccion;
    updateAjusteUiHints();
    renderAjustes();
  });

  updateAjusteUiHints();
}

if ($("#ajAdd")) {
  $("#ajAdd").onclick = () => {
    const producto = $("#ajProducto")?.value?.trim() || "";
    const id_producto = Number($("#ajProducto")?.dataset.id || 0);
    const cantidad = Number($("#ajCantidad")?.value || 0);
    const direccion = String($("#ajDireccion")?.value || "ENTRADA");
    const isEntrada = direccion === "ENTRADA";
    const lote = ($("#ajLote")?.value || "").trim();
    const caducidad = $("#ajCaducidad")?.value || "";
    const costo_unitario = Number($("#ajCosto")?.value || 0);
    const observacion_linea = ($("#ajObsLinea")?.value || "").trim();

    if (!producto || !id_producto) {
      showEntToast("Selecciona el producto desde el buscador.", "bad");
      markError($("#ajProducto"));
      return;
    }
    if (!cantidad || cantidad <= 0) {
      showEntToast("Ingresa una cantidad valida.", "bad");
      markError($("#ajCantidad"));
      return;
    }
    if (isEntrada && !lote) {
      showEntToast("Para entrada por ajuste, el lote es obligatorio.", "bad");
      markError($("#ajLote"));
      return;
    }

    ajList.push({
      id_producto,
      producto,
      cantidad,
      lote: isEntrada ? lote : "",
      caducidad: isEntrada ? caducidad : "",
      costo_unitario: isEntrada ? costo_unitario : 0,
      observacion_linea,
    });

    if ($("#ajProducto")) {
      $("#ajProducto").value = "";
      $("#ajProducto").dataset.id = "";
      $("#ajProducto").dataset.sku = "";
    }
    ajStockActual = null;
    updateAjusteStockPreview();
    if ($("#ajLote")) $("#ajLote").value = "";
    if ($("#ajCaducidad")) $("#ajCaducidad").value = "";
    if ($("#ajCosto")) $("#ajCosto").value = "";
    if ($("#ajCantidad")) $("#ajCantidad").value = "";
    if ($("#ajObsLinea")) $("#ajObsLinea").value = "";

    updateAjusteImpactPreview();
    renderAjustes();
  };
}

if ($("#ajClear")) {
  $("#ajClear").onclick = async () => {
    if (!ajList.length) return;
    if (!(await uiConfirm("Vaciar lineas de ajuste?", "Confirmar vaciado"))) return;
    ajList.splice(0, ajList.length);
    renderAjustes();
  };
}

if ($("#ajSave")) {
  $("#ajSave").onclick = async () => {
    if (ajSaveInFlight) return;
    if (!ajList.length) return;
    const direccion = String($("#ajDireccion")?.value || "ENTRADA");
    const id_motivo = Number($("#ajMotivo")?.value || 0);
    if (!id_motivo) {
      showEntToast("Selecciona motivo de ajuste.", "bad");
      markError($("#ajMotivo"));
      return;
    }
    const id_bodega = Number($("#ajWarehouse")?.value || 0);
    const payload = {
      direccion,
      id_motivo,
      id_bodega: id_bodega || null,
      observaciones: ($("#ajObservacion")?.value || "").trim() || null,
      lines: ajList.map((x) => ({
        id_producto: x.id_producto,
        cantidad: Number(x.cantidad || 0),
        lote: x.lote || null,
        caducidad: x.caducidad || null,
        costo_unitario: Number(x.costo_unitario || 0),
        observacion_linea: x.observacion_linea || null,
      })),
    };
    ajSaveInFlight = true;
    const ajSaveBtn = $("#ajSave");
    if (ajSaveBtn) {
      ajSaveBtn.disabled = true;
      ajSaveBtn.classList.add('is-saving');
    }
    showSavingProgressToast("ajuste");
    try {
      let r = await fetch("/api/ajustes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(payload),
      });
      let j = await r.json().catch(() => ({}));
      if (!r.ok && (j.code === "SENSITIVE_APPROVAL_REQUIRED" || j.code === "SUPERVISOR_PIN_REQUIRED")) {
        const ap = await promptSensitiveApproval("ajuste");
        if (!ap) {
          showEntToast("Operacion cancelada: falta validacion de supervisor.", "bad");
          return;
        }
        r = await fetch("/api/ajustes", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify({ ...payload, ...ap }),
        });
        j = await r.json().catch(() => ({}));
      }
      if (!r.ok) {
        showEntToast(j.error || "No se pudo guardar el ajuste.", "bad");
        return;
      }
      showSupervisorAuthBadge(j.sensitive_approval);
      showEntToast(`Ajuste guardado #${j.id_movimiento}`, "ok");
      ajList.splice(0, ajList.length);
      renderAjustes();
      if ($("#ajObservacion")) $("#ajObservacion").value = "";
    } catch {
      showEntToast("Error de red.", "bad");
    } finally {
      ajSaveInFlight = false;
      const ajFinallyBtn = $("#ajSave");
      if (ajFinallyBtn) ajFinallyBtn.classList.remove('is-saving');
      renderAjustes();
    }
  };
}
window.addEventListener("beforeunload", (e) => {
  if (entList.length || salList.length || ajList.length) {
    e.preventDefault();
    e.returnValue = "";
  }
});

if ($("#bodSave")) {
  $("#bodSave").onclick = async () => {
    const nombre_bodega = $("#bodNombre")?.value?.trim() || "";
    const tipo_bodega = $("#bodTipo")?.value || "";
    const activo = Number($("#bodActivo")?.value || 1);
    const maneja_stock = Number($("#bodStock")?.value || 1);
    const puede_recibir = Number($("#bodRecibir")?.value || 1);
    const puede_despachar = Number($("#bodDespachar")?.value || 1);
    const permite_salida_conteo_final = Number($("#bodConteoFinal")?.value || 0);
    const requiere_precio_salida = Number($("#bodPrecioSalida")?.value || 0);
    const modo_despacho_auto = $("#bodModo")?.value || "SALIDA";
    const id_bodega_destino_default = Number($("#bodDestino")?.value || 0) || null;
    const telefono_contacto = $("#bodTelefono")?.value?.trim() || "";
    const direccion_contacto = $("#bodDireccion")?.value?.trim() || "";

    if (!nombre_bodega) {
      showEntToast("El nombre de bodega es obligatorio.", "bad");
      markError($("#bodNombre"));
      return;
    }
    if (!tipo_bodega) {
      showEntToast("Selecciona el tipo de bodega.", "bad");
      markError($("#bodTipo"));
      return;
    }

    try {
      const r = await fetch("/api/bodegas", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          nombre_bodega,
          tipo_bodega,
          activo,
          maneja_stock,
          puede_recibir,
          puede_despachar,
          permite_salida_conteo_final,
          requiere_precio_salida,
          modo_despacho_auto,
          id_bodega_destino_default,
          telefono_contacto,
          direccion_contacto,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        showEntToast(j.error || "Error guardando bodega.", "bad");
        return;
      }
      showEntToast(`Bodega creada #${j.id_bodega}`, "ok");
      $("#bodNombre").value = "";
      $("#bodTipo").value = "";
      $("#bodDestino").value = "";
      $("#bodConteoFinal").value = "0";
      $("#bodPrecioSalida").value = "0";
      if ($("#bodTelefono")) $("#bodTelefono").value = "";
      if ($("#bodDireccion")) $("#bodDireccion").value = "";
      loadBodegasManage();
    } catch {
      showEntToast("Error de red.", "bad");
    }
  };
}

function bodegaEstadoTag(active) {
  return Number(active) ? `<span class="badgeTag ok">Activa</span>` : `<span class="badgeTag warn">Inactiva</span>`;
}

async function loadBodegaLogoEditor(idBodega, force = false) {
  const id = Number(idBodega || 0);
  if (!id) {
    if ($("#bodLogoAppData")) $("#bodLogoAppData").value = "";
    if ($("#bodLogoPrintData")) $("#bodLogoPrintData").value = "";
    if ($("#bodLogoAppFile")) $("#bodLogoAppFile").value = "";
    if ($("#bodLogoPrintFile")) $("#bodLogoPrintFile").value = "";
    setLogoPreview("#bodLogoAppPreviewImg", "#bodLogoAppPreviewFallback", "");
    setLogoPreview("#bodLogoPrintPreviewImg", "#bodLogoPrintPreviewFallback", "");
    return;
  }
  try {
    const payload = await fetchWarehouseLogoPayload(id, { force });
    if ($("#bodLogoAppData")) $("#bodLogoAppData").value = payload.app || "";
    if ($("#bodLogoPrintData")) $("#bodLogoPrintData").value = payload.print || "";
    if ($("#bodLogoAppFile")) $("#bodLogoAppFile").value = "";
    if ($("#bodLogoPrintFile")) $("#bodLogoPrintFile").value = "";
    setLogoPreview("#bodLogoAppPreviewImg", "#bodLogoAppPreviewFallback", payload.app || "");
    setLogoPreview("#bodLogoPrintPreviewImg", "#bodLogoPrintPreviewFallback", payload.print || "");
  } catch {
    if ($("#bodLogoAppData")) $("#bodLogoAppData").value = "";
    if ($("#bodLogoPrintData")) $("#bodLogoPrintData").value = "";
    setLogoPreview("#bodLogoAppPreviewImg", "#bodLogoAppPreviewFallback", "");
    setLogoPreview("#bodLogoPrintPreviewImg", "#bodLogoPrintPreviewFallback", "");
  }
}

async function saveBodegaLogo() {
  const id_bodega = Number($("#bodEditId")?.value || 0);
  if (!id_bodega) {
    showEntToast("Primero selecciona una bodega para editar.", "bad");
    return;
  }
  const logo_app_data = ($("#bodLogoAppData")?.value || "").trim() || null;
  const logo_print_data = ($("#bodLogoPrintData")?.value || "").trim() || null;
  try {
    const r = await fetch(`/api/bodegas/${id_bodega}/logo`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ logo_app_data, logo_print_data }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      showEntToast(j.error || "No se pudo guardar el logo.", "bad");
      return;
    }
    warehouseLogoCache.delete(id_bodega);
    await loadBodegaLogoEditor(id_bodega, true);
    if (Number(me?.id_warehouse || 0) === id_bodega) {
      await applyWarehouseBranding(id_bodega);
    }
    showEntToast(
      logo_app_data || logo_print_data ? "Logos de bodega guardados." : "Logos de bodega eliminados.",
      "ok"
    );
  } catch {
    showEntToast("Error de red guardando logo.", "bad");
  }
}


function updateWarehouseLogoActionState(warehouse = null) {
  const btn = $("#bodLogoSave");
  if (!btn) return;
  if (!warehouse || !Number(warehouse.id_bodega || 0)) {
    btn.textContent = "Guardar logos";
    btn.disabled = true;
    return;
  }
  const name = String(warehouse.nombre_bodega || `Bodega #${warehouse.id_bodega}`).trim();
  btn.textContent = `Guardar logos de ${name}`;
  btn.disabled = false;
}
function updateWarehouseEditSummary(warehouse = null) {
  const box = $("#bodEditSummary");
  if (!box) return;
  if (!warehouse || !Number(warehouse.id_bodega || 0)) {
    box.innerHTML =
      '<div class="warehouseEditSummaryTitle">Ninguna bodega seleccionada</div>' +
      '<div class="warehouseEditSummaryMeta">Presiona el boton editar en el listado para cargar la informacion aqui.</div>';
    box.classList.remove("is-active");
    updateWarehouseLogoActionState(null);
    return;
  }

  const estado = Number(warehouse.activo) ? "Activa" : "Inactiva";
  const destino = warehouse.nombre_bodega_destino_default || warehouse.id_bodega_destino_default || "Sin destino";
  const modo = warehouse.modo_despacho_auto || "SALIDA";
  const tipo = warehouse.tipo_bodega || "Sin tipo";

  box.innerHTML =
    `<div class="warehouseEditSummaryTitle">Editando: ${escapeHtml(warehouse.nombre_bodega || `Bodega #${warehouse.id_bodega}`)}</div>` +
    `<div class="warehouseEditSummaryMeta">ID ${warehouse.id_bodega} | ${escapeHtml(tipo)} | ${estado} | Modo: ${escapeHtml(modo)} | Destino: ${escapeHtml(String(destino))}</div>`;
  box.classList.add("is-active");
  updateWarehouseLogoActionState(warehouse);
}

async function loadBodegasManage() {
  const tb = $("#bodManageList");
  if (!tb) return;
  tb.innerHTML = `<tr><td colspan="7">Cargando...</td></tr>`;
  try {
    const r = await fetch("/api/bodegas?all=1", {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) {
      tb.innerHTML = `<tr><td colspan="7">Error al cargar bodegas</td></tr>`;
      return;
    }
    if (!rows.length) {
      tb.innerHTML = `<tr><td colspan="7">Sin bodegas</td></tr>`;
      return;
    }

    const destSel = $("#bodDestino");
    const destEditSel = $("#bodEditDestino");
    const prevDest = String(destSel?.value || "");
    const prevDestEdit = String(destEditSel?.value || "");
    const destOpts =
      `<option value="">Sin destino default</option>` +
      rows.map((b) => `<option value="${b.id_bodega}">${escapeHtml(b.nombre_bodega || "")}</option>`).join("");
    if (destSel) {
      destSel.innerHTML = destOpts;
      if (prevDest && rows.some((b) => String(b.id_bodega) === prevDest)) destSel.value = prevDest;
    }
    if (destEditSel) {
      destEditSel.innerHTML = destOpts;
      if (prevDestEdit && rows.some((b) => String(b.id_bodega) === prevDestEdit)) destEditSel.value = prevDestEdit;
    }

    tb.innerHTML = rows
      .map(
        (b) => `
        <tr>
          <td>${b.id_bodega}</td>
          <td>${b.nombre_bodega || ""}</td>
          <td>${b.tipo_bodega || ""}</td>
          <td>${bodegaEstadoTag(b.activo)}</td>
          <td>${b.modo_despacho_auto || "SALIDA"}</td>
          <td>${b.nombre_bodega_destino_default || b.id_bodega_destino_default || "-"}</td>
          <td>
            <button class="iconBtn edit" data-bedit="${b.id_bodega}" title="Editar">E</button>
          </td>
        </tr>
      `
      )
      .join("");

    tb.querySelectorAll("[data-bedit]").forEach((btn) => {
      btn.onclick = () => {
        const id = Number(btn.dataset.bedit || 0);
        const b = rows.find((x) => Number(x.id_bodega) === id);
        if (!b) return;
        tb.querySelectorAll("tr").forEach((row) => row.classList.remove("is-editing"));
        btn.closest("tr")?.classList.add("is-editing");
        $("#bodEditId").value = String(b.id_bodega);
        $("#bodEditNombre").value = b.nombre_bodega || "";
        $("#bodEditTipo").value = b.tipo_bodega || "";
        $("#bodEditActivo").value = Number(b.activo) ? "1" : "0";
        $("#bodEditStock").value = Number(b.maneja_stock) ? "1" : "0";
        $("#bodEditRecibir").value = Number(b.puede_recibir) ? "1" : "0";
        $("#bodEditDespachar").value = Number(b.puede_despachar) ? "1" : "0";
        $("#bodEditConteoFinal").value = Number(b.permite_salida_conteo_final) ? "1" : "0";
        $("#bodEditPrecioSalida").value = Number(b.requiere_precio_salida) ? "1" : "0";
        $("#bodEditModo").value = b.modo_despacho_auto || "SALIDA";
        $("#bodEditDestino").value = b.id_bodega_destino_default || "";
        if ($("#bodEditTelefono")) $("#bodEditTelefono").value = b.telefono_contacto || "";
        if ($("#bodEditDireccion")) $("#bodEditDireccion").value = b.direccion_contacto || "";
        updateWarehouseEditSummary(b);
        loadBodegaLogoEditor(b.id_bodega, true);
        const editSection = Array.from(document.querySelectorAll("#view-bodegas [data-bod-collapse]")).find(
          (sec) => sec.querySelector(".panelTitle")?.textContent?.trim() === "Editar bodega"
        );
        syncBodegasCollapseState(editSection, true);
        editSection?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      };
    });
  } catch {
    tb.innerHTML = `<tr><td colspan="8">Error de red</td></tr>`;
  }
}

if ($("#bodRefresh")) {
  $("#bodRefresh").onclick = loadBodegasManage;
}

if ($("#bodEditSave")) {
  $("#bodEditSave").onclick = async () => {
    const id_bodega = Number($("#bodEditId")?.value || 0);
    const nombre_bodega = $("#bodEditNombre")?.value?.trim() || "";
    const tipo_bodega = $("#bodEditTipo")?.value || "";
    const activo = Number($("#bodEditActivo")?.value || 1);
    const maneja_stock = Number($("#bodEditStock")?.value || 1);
    const puede_recibir = Number($("#bodEditRecibir")?.value || 1);
    const puede_despachar = Number($("#bodEditDespachar")?.value || 1);
    const permite_salida_conteo_final = Number($("#bodEditConteoFinal")?.value || 0);
    const requiere_precio_salida = Number($("#bodEditPrecioSalida")?.value || 0);
    const modo_despacho_auto = $("#bodEditModo")?.value || "SALIDA";
    const id_bodega_destino_default = Number($("#bodEditDestino")?.value || 0) || null;
    const telefono_contacto = $("#bodEditTelefono")?.value?.trim() || "";
    const direccion_contacto = $("#bodEditDireccion")?.value?.trim() || "";

    if (!id_bodega) {
      showEntToast("Primero selecciona una bodega de la lista.", "bad");
      return;
    }
    if (!nombre_bodega) {
      showEntToast("El nombre de bodega es obligatorio.", "bad");
      markError($("#bodEditNombre"));
      return;
    }
    if (!tipo_bodega) {
      showEntToast("Selecciona el tipo de bodega.", "bad");
      markError($("#bodEditTipo"));
      return;
    }

    try {
      const r = await fetch(`/api/bodegas/${id_bodega}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          nombre_bodega,
          tipo_bodega,
          activo,
          maneja_stock,
          puede_recibir,
          puede_despachar,
          permite_salida_conteo_final,
          requiere_precio_salida,
          modo_despacho_auto,
          id_bodega_destino_default,
          telefono_contacto,
          direccion_contacto,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        showEntToast(j.error || "Error actualizando bodega.", "bad");
        return;
      }
      showEntToast("Bodega actualizada.", "ok");
      $("#bodEditId").value = "";
      $("#bodEditNombre").value = "";
      $("#bodEditTipo").value = "";
      $("#bodEditActivo").value = "1";
      $("#bodEditStock").value = "1";
      $("#bodEditRecibir").value = "1";
      $("#bodEditDespachar").value = "1";
      $("#bodEditConteoFinal").value = "0";
      $("#bodEditPrecioSalida").value = "0";
      $("#bodEditModo").value = "SALIDA";
      $("#bodEditDestino").value = "";
      if ($("#bodEditTelefono")) $("#bodEditTelefono").value = "";
      if ($("#bodEditDireccion")) $("#bodEditDireccion").value = "";
      warehouseContactCache.delete(id_bodega);
      if ($("#bodLogoAppData")) $("#bodLogoAppData").value = "";
      if ($("#bodLogoPrintData")) $("#bodLogoPrintData").value = "";
      if ($("#bodLogoAppFile")) $("#bodLogoAppFile").value = "";
      if ($("#bodLogoPrintFile")) $("#bodLogoPrintFile").value = "";
      setLogoPreview("#bodLogoAppPreviewImg", "#bodLogoAppPreviewFallback", "");
      setLogoPreview("#bodLogoPrintPreviewImg", "#bodLogoPrintPreviewFallback", "");
      updateWarehouseEditSummary(null);
      loadBodegasManage();
      bodegasLoaded = false;
      loadBodegasPedido();
      usrBodegasLoaded = false;
      loadBodegasUsuarioForm();
      warehouseLogoCache.delete(id_bodega);
      if (Number(me?.id_warehouse || 0) === id_bodega) {
        await applyWarehouseBranding(id_bodega);
      }
    } catch {
      showEntToast("Error de red.", "bad");
    }
  };
}

if ($("#bodLogoSave")) {
  $("#bodLogoSave").onclick = saveBodegaLogo;
  updateWarehouseLogoActionState(null);
}

async function loadCategoriasManage() {
  const tb = $("#catManageList");
  if (!tb) return;
  tb.innerHTML = `<tr><td colspan="4">Cargando...</td></tr>`;
  try {
    const r = await fetch("/api/categorias?all=1", {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) {
      tb.innerHTML = `<tr><td colspan="4">Error al cargar categorias</td></tr>`;
      return;
    }
    if (!rows.length) {
      tb.innerHTML = `<tr><td colspan="4">Sin categorias registradas</td></tr>`;
      return;
    }
    tb.innerHTML = rows
      .map(
        (c) => `
        <tr>
          <td>${c.id_categoria}</td>
          <td>${c.nombre_categoria || ""}</td>
          <td>${yesNoBadge(c.activo)}</td>
          <td style="white-space:nowrap;">
            <div class="gridActions">
              <button class="iconBtn edit" data-cedit="${c.id_categoria}" title="Editar">E</button>
              <button class="iconBtn del" data-cdis="${c.id_categoria}" title="Eliminar">X</button>
            </div>
          </td>
        </tr>
      `
      )
      .join("");

    tb.querySelectorAll("[data-cedit]").forEach((btn) => {
      btn.onclick = () => {
        const id = Number(btn.dataset.cedit || 0);
        const c = rows.find((x) => Number(x.id_categoria) === id);
        if (!c) return;
        $("#catEditId").value = String(c.id_categoria);
        $("#catEditNombre").value = c.nombre_categoria || "";
        $("#catEditActivo").value = Number(c.activo) ? "1" : "0";
        openAdminCollapseSection('view-categorias', 'Editar categoria');
      };
    });

    tb.querySelectorAll("[data-cdis]").forEach((btn) => {
      btn.onclick = async () => {
        const id = Number(btn.dataset.cdis || 0);
        if (!id) return;
        if (!(await uiConfirm("Eliminar (desactivar) esta categoria?", "Confirmar desactivacion"))) return;
        try {
          const rr = await fetch(`/api/categorias/${id}/deactivate`, {
            method: "POST",
            headers: { Authorization: "Bearer " + token },
          });
          const jj = await rr.json().catch(() => ({}));
          if (!rr.ok) {
            showEntToast(jj.error || "Error eliminando categoria.", "bad");
            return;
          }
          showEntToast("Categoria eliminada.", "ok");
          loadCategoriasManage();
          prdCatalogosLoaded = false;
          subcatCatalogosLoaded = false;
        } catch {
          showEntToast("Error de red.", "bad");
        }
      };
    });
  } catch {
    tb.innerHTML = `<tr><td colspan="4">Error de red</td></tr>`;
  }
}

if ($("#catSave")) {
  $("#catSave").onclick = async () => {
    const nombre_categoria = $("#catNombre")?.value?.trim() || "";
    const activo = Number($("#catActivo")?.value || 1);

    if (!nombre_categoria) {
      showEntToast("El nombre de la categoria es obligatorio.", "bad");
      markError($("#catNombre"));
      return;
    }

    try {
      const r = await fetch("/api/categorias", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ nombre_categoria, activo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        showEntToast(j.error || "Error guardando categoria.", "bad");
        return;
      }
      showEntToast(`Categoria creada #${j.id_categoria}`, "ok");
      $("#catNombre").value = "";
      $("#catActivo").value = "1";
      loadCategoriasManage();
      prdCatalogosLoaded = false;
      subcatCatalogosLoaded = false;
    } catch {
      showEntToast("Error de red.", "bad");
    }
  };
}

if ($("#catRefresh")) {
  $("#catRefresh").onclick = loadCategoriasManage;
}

if ($("#catEditSave")) {
  $("#catEditSave").onclick = async () => {
    const id_categoria = Number($("#catEditId")?.value || 0);
    const nombre_categoria = $("#catEditNombre")?.value?.trim() || "";
    const activo = Number($("#catEditActivo")?.value || 1);

    if (!id_categoria) {
      showEntToast("Selecciona una categoria de la lista.", "bad");
      return;
    }
    if (!nombre_categoria) {
      showEntToast("El nombre de la categoria es obligatorio.", "bad");
      markError($("#catEditNombre"));
      return;
    }

    try {
      const r = await fetch(`/api/categorias/${id_categoria}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ nombre_categoria, activo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        showEntToast(j.error || "Error actualizando categoria.", "bad");
        return;
      }
      showEntToast("Categoria actualizada.", "ok");
      $("#catEditId").value = "";
      $("#catEditNombre").value = "";
      $("#catEditActivo").value = "1";
      loadCategoriasManage();
      prdCatalogosLoaded = false;
      subcatCatalogosLoaded = false;
    } catch {
      showEntToast("Error de red.", "bad");
    }
  };
}

async function loadSubcatCatalogos() {
  if (subcatCatalogosLoaded) return;
  try {
    const r = await fetch("/api/categorias", {
      headers: { Authorization: "Bearer " + token },
    });
    const categorias = await r.json().catch(() => []);
    if (!r.ok) return;
    const opts =
      `<option value="">Seleccione categoria</option>` +
      categorias.map((c) => `<option value="${c.id_categoria}">${c.nombre_categoria}</option>`).join("");
    if ($("#subCatCategoria")) $("#subCatCategoria").innerHTML = opts;
    if ($("#subCatEditCategoria")) $("#subCatEditCategoria").innerHTML = opts;
    subcatCatalogosLoaded = true;
  } catch (e) { console.error('loadBodegaUsuario:', e); }
}

async function loadSubcategoriasManage() {
  const tb = $("#subCatManageList");
  if (!tb) return;
  tb.innerHTML = `<tr><td colspan="5">Cargando...</td></tr>`;
  try {
    const r = await fetch("/api/subcategorias?all=1", {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) {
      tb.innerHTML = `<tr><td colspan="5">Error al cargar subcategorias</td></tr>`;
      return;
    }
    if (!rows.length) {
      tb.innerHTML = `<tr><td colspan="5">Sin subcategorias registradas</td></tr>`;
      return;
    }
    tb.innerHTML = rows
      .map(
        (s) => `
        <tr>
          <td>${s.id_subcategoria}</td>
          <td>${s.nombre_categoria || "-"}</td>
          <td>${s.nombre_subcategoria || ""}</td>
          <td>${yesNoBadge(s.activo)}</td>
          <td style="white-space:nowrap;">
            <div class="gridActions">
              <button class="iconBtn edit" data-scedit="${s.id_subcategoria}" title="Editar">E</button>
              <button class="iconBtn del" data-scdis="${s.id_subcategoria}" title="Eliminar">X</button>
            </div>
          </td>
        </tr>
      `
      )
      .join("");

    tb.querySelectorAll("[data-scedit]").forEach((btn) => {
      btn.onclick = () => {
        const id = Number(btn.dataset.scedit || 0);
        const s = rows.find((x) => Number(x.id_subcategoria) === id);
        if (!s) return;
        $("#subCatEditId").value = String(s.id_subcategoria);
        $("#subCatEditCategoria").value = s.id_categoria ? String(s.id_categoria) : "";
        $("#subCatEditNombre").value = s.nombre_subcategoria || "";
        $("#subCatEditActivo").value = Number(s.activo) ? "1" : "0";
        openAdminCollapseSection('view-subcategorias', 'Editar subcategoria');
      };
    });

    tb.querySelectorAll("[data-scdis]").forEach((btn) => {
      btn.onclick = async () => {
        const id = Number(btn.dataset.scdis || 0);
        if (!id) return;
        if (!(await uiConfirm("Eliminar (desactivar) esta subcategoria?", "Confirmar desactivacion"))) return;
        try {
          const rr = await fetch(`/api/subcategorias/${id}/deactivate`, {
            method: "POST",
            headers: { Authorization: "Bearer " + token },
          });
          const jj = await rr.json().catch(() => ({}));
          if (!rr.ok) {
            showEntToast(jj.error || "Error eliminando subcategoria.", "bad");
            return;
          }
          showEntToast("Subcategoria eliminada.", "ok");
          loadSubcategoriasManage();
          prdCatalogosLoaded = false;
          regCatalogosLoaded = false;
        } catch {
          showEntToast("Error de red.", "bad");
        }
      };
    });
  } catch {
    tb.innerHTML = `<tr><td colspan="5">Error de red</td></tr>`;
  }
}

if ($("#subCatSave")) {
  $("#subCatSave").onclick = async () => {
    const id_categoria = Number($("#subCatCategoria")?.value || 0);
    const nombre_subcategoria = $("#subCatNombre")?.value?.trim() || "";
    const activo = Number($("#subCatActivo")?.value || 1);

    if (!id_categoria) {
      showEntToast("Selecciona categoria.", "bad");
      markError($("#subCatCategoria"));
      return;
    }
    if (!nombre_subcategoria) {
      showEntToast("El nombre de la subcategoria es obligatorio.", "bad");
      markError($("#subCatNombre"));
      return;
    }

    try {
      const r = await fetch("/api/subcategorias", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ id_categoria, nombre_subcategoria, activo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        showEntToast(j.error || "Error guardando subcategoria.", "bad");
        return;
      }
      showEntToast(`Subcategoria creada #${j.id_subcategoria}`, "ok");
      $("#subCatCategoria").value = "";
      $("#subCatNombre").value = "";
      $("#subCatActivo").value = "1";
      loadSubcategoriasManage();
      prdCatalogosLoaded = false;
      regCatalogosLoaded = false;
    } catch {
      showEntToast("Error de red.", "bad");
    }
  };
}

if ($("#subCatEditSave")) {
  $("#subCatEditSave").onclick = async () => {
    const id_subcategoria = Number($("#subCatEditId")?.value || 0);
    const id_categoria = Number($("#subCatEditCategoria")?.value || 0);
    const nombre_subcategoria = $("#subCatEditNombre")?.value?.trim() || "";
    const activo = Number($("#subCatEditActivo")?.value || 1);

    if (!id_subcategoria) {
      showEntToast("Selecciona una subcategoria de la lista.", "bad");
      return;
    }
    if (!id_categoria) {
      showEntToast("Selecciona categoria.", "bad");
      markError($("#subCatEditCategoria"));
      return;
    }
    if (!nombre_subcategoria) {
      showEntToast("El nombre de la subcategoria es obligatorio.", "bad");
      markError($("#subCatEditNombre"));
      return;
    }

    try {
      const r = await fetch(`/api/subcategorias/${id_subcategoria}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ id_categoria, nombre_subcategoria, activo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        showEntToast(j.error || "Error actualizando subcategoria.", "bad");
        return;
      }
      showEntToast("Subcategoria actualizada.", "ok");
      $("#subCatEditId").value = "";
      $("#subCatEditCategoria").value = "";
      $("#subCatEditNombre").value = "";
      $("#subCatEditActivo").value = "1";
      loadSubcategoriasManage();
      prdCatalogosLoaded = false;
      regCatalogosLoaded = false;
    } catch {
      showEntToast("Error de red.", "bad");
    }
  };
}

if ($("#subCatRefresh")) {
  $("#subCatRefresh").onclick = loadSubcategoriasManage;
}

async function loadProveedoresManage() {
  const tb = $("#provManageList");
  if (!tb) return;
  tb.innerHTML = `<tr><td colspan="6">Cargando...</td></tr>`;
  try {
    const r = await fetch("/api/proveedores?all=1", {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) {
      tb.innerHTML = `<tr><td colspan="6">Error al cargar proveedores</td></tr>`;
      return;
    }
    if (!rows.length) {
      tb.innerHTML = `<tr><td colspan="6">Sin proveedores registrados</td></tr>`;
      return;
    }
    tb.innerHTML = rows
      .map(
        (p) => `
        <tr>
          <td>${p.id_proveedor}</td>
          <td>${p.nombre_proveedor || ""}</td>
          <td>${p.telefono || "-"}</td>
          <td>${p.direccion || "-"}</td>
          <td>${yesNoBadge(p.activo)}</td>
          <td style="white-space:nowrap;">
            <div class="gridActions">
              <button class="iconBtn edit" data-pvedit="${p.id_proveedor}" title="Editar">E</button>
              <button class="iconBtn del" data-pvdis="${p.id_proveedor}" title="Eliminar">X</button>
            </div>
          </td>
        </tr>
      `
      )
      .join("");

    tb.querySelectorAll("[data-pvedit]").forEach((btn) => {
      btn.onclick = () => {
        const id = Number(btn.dataset.pvedit || 0);
        const p = rows.find((x) => Number(x.id_proveedor) === id);
        if (!p) return;
        $("#provEditId").value = String(p.id_proveedor);
        $("#provEditNombre").value = p.nombre_proveedor || "";
        $("#provEditTelefono").value = p.telefono || "";
        $("#provEditDireccion").value = p.direccion || "";
        $("#provEditActivo").value = Number(p.activo) ? "1" : "0";
        openAdminCollapseSection('view-proveedores', 'Editar proveedor');
      };
    });

    tb.querySelectorAll("[data-pvdis]").forEach((btn) => {
      btn.onclick = async () => {
        const id = Number(btn.dataset.pvdis || 0);
        if (!id) return;
        if (!(await uiConfirm("Eliminar (desactivar) este proveedor?", "Confirmar desactivacion"))) return;
        try {
          const rr = await fetch(`/api/proveedores/${id}/deactivate`, {
            method: "POST",
            headers: { Authorization: "Bearer " + token },
          });
          const jj = await rr.json().catch(() => ({}));
          if (!rr.ok) {
            showEntToast(jj.error || "Error eliminando proveedor.", "bad");
            return;
          }
          showEntToast("Proveedor eliminado.", "ok");
          loadProveedoresManage();
          proveedoresLoaded = false;
          loadProveedores();
        } catch {
          showEntToast("Error de red.", "bad");
        }
      };
    });
  } catch {
    tb.innerHTML = `<tr><td colspan="7">Error de red</td></tr>`;
  }
}

if ($("#provSave")) {
  $("#provSave").onclick = async () => {
    const nombre_proveedor = $("#provNombre")?.value?.trim() || "";
    const telefono = $("#provTelefono")?.value?.trim() || "";
    const direccion = $("#provDireccion")?.value?.trim() || "";
    const activo = Number($("#provActivo")?.value || 1);

    if (!nombre_proveedor) {
      showEntToast("El nombre del proveedor es obligatorio.", "bad");
      markError($("#provNombre"));
      return;
    }

    try {
      const r = await fetch("/api/proveedores", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ nombre_proveedor, telefono, direccion, activo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        showEntToast(j.error || "Error guardando proveedor.", "bad");
        return;
      }
      showEntToast(`Proveedor creado #${j.id_proveedor}`, "ok");
      $("#provNombre").value = "";
      $("#provTelefono").value = "";
      $("#provDireccion").value = "";
      $("#provActivo").value = "1";
      loadProveedoresManage();
      proveedoresLoaded = false;
      loadProveedores();
    } catch {
      showEntToast("Error de red.", "bad");
    }
  };
}

if ($("#provEditSave")) {
  $("#provEditSave").onclick = async () => {
    const id_proveedor = Number($("#provEditId")?.value || 0);
    const nombre_proveedor = $("#provEditNombre")?.value?.trim() || "";
    const telefono = $("#provEditTelefono")?.value?.trim() || "";
    const direccion = $("#provEditDireccion")?.value?.trim() || "";
    const activo = Number($("#provEditActivo")?.value || 1);

    if (!id_proveedor) {
      showEntToast("Selecciona un proveedor de la lista.", "bad");
      return;
    }
    if (!nombre_proveedor) {
      showEntToast("El nombre del proveedor es obligatorio.", "bad");
      markError($("#provEditNombre"));
      return;
    }

    try {
      const r = await fetch(`/api/proveedores/${id_proveedor}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ nombre_proveedor, telefono, direccion, activo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        showEntToast(j.error || "Error actualizando proveedor.", "bad");
        return;
      }
      showEntToast("Proveedor actualizado.", "ok");
      $("#provEditId").value = "";
      $("#provEditNombre").value = "";
      $("#provEditTelefono").value = "";
      $("#provEditDireccion").value = "";
      $("#provEditActivo").value = "1";
      loadProveedoresManage();
      proveedoresLoaded = false;
      loadProveedores();
    } catch {
      showEntToast("Error de red.", "bad");
    }
  };
}

if ($("#provRefresh")) {
  $("#provRefresh").onclick = loadProveedoresManage;
}

function motivoEstadoTag(active) {
  return Number(active) ? `<span class="badgeTag ok">Activo</span>` : `<span class="badgeTag warn">Inactivo</span>`;
}

async function loadMotivosManage() {
  const tb = $("#motList");
  if (!tb) return;
  tb.innerHTML = `<tr><td colspan="5">Cargando...</td></tr>`;
  try {
    const r = await fetch("/api/motivos?all=1", {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) {
      tb.innerHTML = `<tr><td colspan="5">Error al cargar motivos</td></tr>`;
      return;
    }
    if (!rows.length) {
      tb.innerHTML = `<tr><td colspan="5">Sin motivos registrados</td></tr>`;
      return;
    }
    tb.innerHTML = rows
      .map(
        (m) => `
        <tr>
          <td>${m.id_motivo}</td>
          <td>${m.nombre_motivo || ""}</td>
          <td>${m.tipo_movimiento || ""}</td>
          <td>${Number(m.signo_cantidad) === -1 ? "-1" : "+1"}</td>
          <td>${motivoEstadoTag(m.activo)}</td>
        </tr>
      `
      )
      .join("");
  } catch {
    tb.innerHTML = `<tr><td colspan="5">Error de red</td></tr>`;
  }
}

if ($("#motTipo")) {
  $("#motTipo").addEventListener("change", () => {
    const tipo = $("#motTipo")?.value || "";
    if (!$("#motSigno")) return;
    if (tipo === "SALIDA") $("#motSigno").value = "-1";
    else $("#motSigno").value = "1";
  });
}

if ($("#motSave")) {
  $("#motSave").onclick = async () => {
    const nombre_motivo = $("#motNombre")?.value?.trim() || "";
    const tipo_movimiento = $("#motTipo")?.value || "";
    const signo_cantidad = Number($("#motSigno")?.value || 1);
    const activo = Number($("#motActivo")?.value || 1);

    if (!nombre_motivo) {
      showEntToast("El nombre del motivo es obligatorio.", "bad");
      markError($("#motNombre"));
      return;
    }
    if (!tipo_movimiento) {
      showEntToast("Selecciona el tipo de movimiento.", "bad");
      markError($("#motTipo"));
      return;
    }

    try {
      const r = await fetch("/api/motivos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ nombre_motivo, tipo_movimiento, signo_cantidad, activo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        showEntToast(j.error || "Error guardando motivo.", "bad");
        return;
      }
      showEntToast(`Motivo creado #${j.id_motivo}`, "ok");
      $("#motNombre").value = "";
      $("#motTipo").value = "";
      $("#motSigno").value = "1";
      $("#motActivo").value = "1";
      loadMotivosManage();
      motivosLoaded = false;
      motivosSalidaLoaded = false;
      loadMotivosEntrada();
      loadMotivosSalida();
    } catch {
      showEntToast("Error de red.", "bad");
    }
  };
}

if ($("#motRefresh")) {
  $("#motRefresh").onclick = loadMotivosManage;
}

async function loadCatalogosProductos() {
  if (prdCatalogosLoaded) return;
  try {
    const [medRes, catRes] = await Promise.all([
      fetch("/api/medidas", { headers: { Authorization: "Bearer " + token } }),
      fetch("/api/categorias", { headers: { Authorization: "Bearer " + token } }),
    ]);
    const medidas = await medRes.json().catch(() => []);
    const categorias = await catRes.json().catch(() => []);
    if (!medRes.ok || !catRes.ok) return;

    const medOpts =
      `<option value="">Seleccione medida</option>` +
      medidas.map((m) => `<option value="${m.id_medida}">${m.nombre_medida}</option>`).join("");
    const catOpts =
      `<option value="">Seleccione categoria</option>` +
      categorias.map((c) => `<option value="${c.id_categoria}">${c.nombre_categoria}</option>`).join("");

    if ($("#prdMedida")) $("#prdMedida").innerHTML = medOpts;
    if ($("#prdEditMedida")) $("#prdEditMedida").innerHTML = medOpts;
    if ($("#prdCategoria")) $("#prdCategoria").innerHTML = catOpts;
    if ($("#prdEditCategoria")) $("#prdEditCategoria").innerHTML = catOpts;
    prdCatalogosLoaded = true;
  } catch (e) { console.error('loadProductosCatalogos:', e); }
}

async function loadSubcategoriasProducto(idCategoria, targetId, selected = "") {
  const sel = $(targetId);
  if (!sel) return;
  if (!idCategoria) {
    sel.innerHTML = `<option value="">Seleccione subcategoria</option>`;
    return;
  }
  try {
    const r = await fetch(`/api/subcategorias?categoria=${encodeURIComponent(idCategoria)}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) return;
    sel.innerHTML =
      `<option value="">Seleccione subcategoria</option>` +
      rows.map((x) => `<option value="${x.id_subcategoria}">${x.nombre_subcategoria}</option>`).join("");
    if (selected) sel.value = String(selected);
  } catch (e) { console.error('loadProductosSubcategorias:', e); }
}

function productoEstadoTag(active) {
  return Number(active) ? `<span class="badgeTag ok">Activo</span>` : `<span class="badgeTag warn">Inactivo</span>`;
}

function normalizeImportKey(v) {
  return String(v || "")
    .replace(/^\ufeff/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function parseCsvFields(rawLine, delimiter) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < rawLine.length; i += 1) {
    const ch = rawLine[i];
    if (ch === '"') {
      if (inQuotes && rawLine[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function isCsvFileName(name) {
  return /\.csv$/i.test(String(name || ""));
}

function isExcelFileName(name) {
  return /\.(xlsx|xls)$/i.test(String(name || ""));
}

function pickSpreadsheetValue(row, aliases) {
  if (!row || typeof row !== "object") return "";
  for (const a of aliases || []) {
    if (Object.prototype.hasOwnProperty.call(row, a)) return String(row[a] || "").trim();
  }
  return "";
}

function hasSpreadsheetHeader(rows, aliases) {
  if (!Array.isArray(rows) || !rows.length) return false;
  return rows.some((row) => (aliases || []).some((a) => Object.prototype.hasOwnProperty.call(row || {}, a)));
}

async function parseImportFile(file, delimiter, csvParser, spreadsheetParser) {
  const fileName = String(file?.name || "");
  if (isCsvFileName(fileName)) {
    const txt = await file.text();
    return csvParser(txt, delimiter);
  }
  if (isExcelFileName(fileName)) {
    if (!window.XLSX) {
      return { rows: [], errors: ["No se pudo cargar el lector de Excel (XLSX)."] };
    }
    const data = await file.arrayBuffer();
    const wb = window.XLSX.read(data, { type: "array" });
    const firstSheet = wb?.SheetNames?.[0] || "";
    const ws = firstSheet ? wb.Sheets[firstSheet] : null;
    if (!ws) return { rows: [], errors: ["El archivo Excel no contiene hojas validas."] };
    const rawRows = window.XLSX.utils.sheet_to_json(ws, { defval: "", raw: false }) || [];
    const normalizedRows = rawRows.map((obj) => {
      const out = {};
      Object.keys(obj || {}).forEach((k) => {
        out[normalizeImportKey(k)] = String(obj[k] ?? "").trim();
      });
      return out;
    });
    return spreadsheetParser(normalizedRows);
  }
  return { rows: [], errors: ["Formato no soportado. Usa CSV o Excel (.xlsx/.xls)."] };
}

function parseProductosCsv(text, delimiter = ",") {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((ln) => ln.trim().length > 0);
  if (!lines.length) return { rows: [], errors: ["El archivo CSV esta vacio."] };

  const headers = parseCsvFields(lines[0], delimiter).map(normalizeImportKey);
  const pickHeader = (aliases) => aliases.find((x) => headers.includes(x)) || "";
  const idx = (aliases) => {
    const k = pickHeader(aliases);
    return k ? headers.indexOf(k) : -1;
  };

  const colNombre = idx(["nombre_producto", "producto", "nombre"]);
  const colSku = idx(["sku"]);
  const colMedida = idx(["medida", "nombre_medida"]);
  const colIdMedida = idx(["id_medida", "medida_id"]);
  const colCategoria = idx(["categoria", "nombre_categoria"]);
  const colIdCategoria = idx(["id_categoria", "categoria_id"]);
  const colSubcategoria = idx(["subcategoria", "nombre_subcategoria"]);
  const colIdSubcategoria = idx(["id_subcategoria", "subcategoria_id"]);
  const colActivo = idx(["activo", "estado"]);

  const errors = [];
  if (colNombre < 0) errors.push("Falta encabezado obligatorio: nombre_producto.");
  if (colMedida < 0 && colIdMedida < 0) errors.push("Falta medida o id_medida.");
  if (colCategoria < 0 && colIdCategoria < 0) errors.push("Falta categoria o id_categoria.");
  if (errors.length) return { rows: [], errors };

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const vals = parseCsvFields(lines[i], delimiter);
    const get = (pos) => (pos >= 0 ? String(vals[pos] || "").trim() : "");
    const reg = {
      _line: i + 1,
      nombre_producto: get(colNombre),
      sku: get(colSku),
      medida: get(colMedida),
      id_medida: get(colIdMedida),
      categoria: get(colCategoria),
      id_categoria: get(colIdCategoria),
      subcategoria: get(colSubcategoria),
      id_subcategoria: get(colIdSubcategoria),
      activo: get(colActivo),
    };
    if (!Object.values(reg).some((x) => String(x || "").trim() !== "")) continue;
    rows.push(reg);
  }
  return { rows, errors: [] };
}

function parseProductosSpreadsheet(rowsIn) {
  const rowsSrc = Array.isArray(rowsIn) ? rowsIn : [];
  if (!rowsSrc.length) return { rows: [], errors: ["El archivo Excel esta vacio."] };

  const errors = [];
  if (!hasSpreadsheetHeader(rowsSrc, ["nombre_producto", "producto", "nombre"])) {
    errors.push("Falta encabezado obligatorio: nombre_producto.");
  }
  if (
    !hasSpreadsheetHeader(rowsSrc, ["medida", "nombre_medida"]) &&
    !hasSpreadsheetHeader(rowsSrc, ["id_medida", "medida_id"])
  ) {
    errors.push("Falta medida o id_medida.");
  }
  if (
    !hasSpreadsheetHeader(rowsSrc, ["categoria", "nombre_categoria"]) &&
    !hasSpreadsheetHeader(rowsSrc, ["id_categoria", "categoria_id"])
  ) {
    errors.push("Falta categoria o id_categoria.");
  }
  if (errors.length) return { rows: [], errors };

  const rows = [];
  rowsSrc.forEach((r, idx) => {
    const reg = {
      _line: idx + 2,
      nombre_producto: pickSpreadsheetValue(r, ["nombre_producto", "producto", "nombre"]),
      sku: pickSpreadsheetValue(r, ["sku"]),
      medida: pickSpreadsheetValue(r, ["medida", "nombre_medida"]),
      id_medida: pickSpreadsheetValue(r, ["id_medida", "medida_id"]),
      categoria: pickSpreadsheetValue(r, ["categoria", "nombre_categoria"]),
      id_categoria: pickSpreadsheetValue(r, ["id_categoria", "categoria_id"]),
      subcategoria: pickSpreadsheetValue(r, ["subcategoria", "nombre_subcategoria"]),
      id_subcategoria: pickSpreadsheetValue(r, ["id_subcategoria", "subcategoria_id"]),
      activo: pickSpreadsheetValue(r, ["activo", "estado"]),
    };
    if (!Object.values(reg).some((x) => String(x || "").trim() !== "")) return;
    rows.push(reg);
  });
  return { rows, errors: [] };
}

function parseActivoImport(v) {
  const x = normalizeImportKey(v);
  if (!x) return 1;
  if (["1", "si", "true", "activo", "yes"].includes(x)) return 1;
  if (["0", "no", "false", "inactivo"].includes(x)) return 0;
  return null;
}

function downloadCsvTemplate(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function importarProductosCsv(file, delimiter) {
  const parsed = await parseImportFile(file, delimiter, parseProductosCsv, parseProductosSpreadsheet);
  if (parsed.errors.length) {
    showEntToast(parsed.errors.join(" "), "bad");
    return;
  }
  if (!parsed.rows.length) {
    showEntToast("No hay filas validas para importar.", "bad");
    return;
  }

  const [medR, catR, subR] = await Promise.all([
    fetch("/api/medidas", { headers: { Authorization: "Bearer " + token } }),
    fetch("/api/categorias?all=1", { headers: { Authorization: "Bearer " + token } }),
    fetch("/api/subcategorias?all=1", { headers: { Authorization: "Bearer " + token } }),
  ]);
  const medidas = await medR.json().catch(() => []);
  const categorias = await catR.json().catch(() => []);
  const subcategorias = await subR.json().catch(() => []);
  if (!medR.ok || !catR.ok || !subR.ok) {
    showEntToast("No se pudieron cargar catalogos para importar.", "bad");
    return;
  }

  const mapMedida = new Map(medidas.map((m) => [normalizeImportKey(m.nombre_medida), Number(m.id_medida)]));
  const mapCategoria = new Map(categorias.map((c) => [normalizeImportKey(c.nombre_categoria), Number(c.id_categoria)]));

  const mapSubByCat = new Map();
  const mapSubGlobal = new Map();
  subcategorias.forEach((s) => {
    const catId = Number(s.id_categoria || 0);
    const subId = Number(s.id_subcategoria || 0);
    const name = normalizeImportKey(s.nombre_subcategoria);
    if (!catId || !subId || !name) return;
    mapSubByCat.set(`${catId}|${name}`, subId);
    if (!mapSubGlobal.has(name)) mapSubGlobal.set(name, []);
    mapSubGlobal.get(name).push({ id_subcategoria: subId, id_categoria: catId });
  });

  const created = [];
  const failed = [];

  for (const row of parsed.rows) {
    const line = Number(row._line || 0);
    const nombre_producto = String(row.nombre_producto || "").trim();
    const sku = String(row.sku || "").trim() || null;
    const id_medida_num = Number(row.id_medida || 0);
    const id_categoria_num = Number(row.id_categoria || 0);
    const id_subcategoria_num = Number(row.id_subcategoria || 0);

    let id_medida = id_medida_num > 0 ? id_medida_num : 0;
    if (!id_medida && row.medida) id_medida = Number(mapMedida.get(normalizeImportKey(row.medida)) || 0);

    let id_categoria = id_categoria_num > 0 ? id_categoria_num : 0;
    if (!id_categoria && row.categoria) id_categoria = Number(mapCategoria.get(normalizeImportKey(row.categoria)) || 0);

    let id_subcategoria = id_subcategoria_num > 0 ? id_subcategoria_num : null;
    if (!id_subcategoria && row.subcategoria) {
      const subKey = normalizeImportKey(row.subcategoria);
      if (id_categoria) {
        id_subcategoria = Number(mapSubByCat.get(`${id_categoria}|${subKey}`) || 0) || null;
      } else {
        const hits = mapSubGlobal.get(subKey) || [];
        if (hits.length === 1) id_subcategoria = Number(hits[0].id_subcategoria || 0) || null;
        if (hits.length > 1) {
          failed.push({ line, reason: "Subcategoria ambigua sin categoria." });
          continue;
        }
      }
    }

    const activo = parseActivoImport(row.activo);
    if (!nombre_producto) {
      failed.push({ line, reason: "nombre_producto es obligatorio." });
      continue;
    }
    if (!id_medida) {
      failed.push({ line, reason: "No se encontro medida (usa medida o id_medida valido)." });
      continue;
    }
    if (!id_categoria) {
      failed.push({ line, reason: "No se encontro categoria (usa categoria o id_categoria valido)." });
      continue;
    }
    if (row.subcategoria && !id_subcategoria) {
      failed.push({ line, reason: "No se encontro subcategoria valida para la categoria indicada." });
      continue;
    }
    if (activo === null) {
      failed.push({ line, reason: "Valor de activo invalido (usa 1/0, si/no)." });
      continue;
    }

    try {
      const r = await fetch("/api/productos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          nombre_producto,
          sku,
          id_medida,
          id_categoria,
          id_subcategoria,
          activo,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        failed.push({ line, reason: j.error || "Error al guardar producto." });
        continue;
      }
      created.push({ line, id: j.id_producto });
    } catch {
      failed.push({ line, reason: "Error de red al guardar." });
    }
  }

  if (created.length && !failed.length) {
    showEntToast(`Importacion completada: ${created.length} productos.`, "ok");
  } else if (created.length && failed.length) {
    showEntToast(`Importacion parcial: ${created.length} creados, ${failed.length} con error.`, "bad");
  } else {
    showEntToast("No se importo ningun producto.", "bad");
  }

  if (failed.length) {
    const detail = failed
      .slice(0, 15)
      .map((x) => `Fila ${x.line}: ${x.reason}`)
      .join("\n");
    showEntToast(
      `Errores de importacion: ${detail.replace(/\n/g, " | ")}${failed.length > 15 ? " | ..." : ""}`,
      "bad"
    );
  }
}

function parseCategoriasCsv(text, delimiter = ",") {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((ln) => ln.trim().length > 0);
  if (!lines.length) return { rows: [], errors: ["El archivo CSV esta vacio."] };

  const headers = parseCsvFields(lines[0], delimiter).map(normalizeImportKey);
  const idx = (aliases) => {
    const k = aliases.find((x) => headers.includes(x)) || "";
    return k ? headers.indexOf(k) : -1;
  };
  const colNombre = idx(["nombre_categoria", "categoria", "nombre"]);
  const colActivo = idx(["activo", "estado"]);

  const errors = [];
  if (colNombre < 0) errors.push("Falta encabezado obligatorio: nombre_categoria.");
  if (errors.length) return { rows: [], errors };

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const vals = parseCsvFields(lines[i], delimiter);
    const get = (pos) => (pos >= 0 ? String(vals[pos] || "").trim() : "");
    const reg = {
      _line: i + 1,
      nombre_categoria: get(colNombre),
      activo: get(colActivo),
    };
    if (!Object.values(reg).some((x) => String(x || "").trim() !== "")) continue;
    rows.push(reg);
  }
  return { rows, errors: [] };
}

function parseCategoriasSpreadsheet(rowsIn) {
  const rowsSrc = Array.isArray(rowsIn) ? rowsIn : [];
  if (!rowsSrc.length) return { rows: [], errors: ["El archivo Excel esta vacio."] };
  if (!hasSpreadsheetHeader(rowsSrc, ["nombre_categoria", "categoria", "nombre"])) {
    return { rows: [], errors: ["Falta encabezado obligatorio: nombre_categoria."] };
  }
  const rows = [];
  rowsSrc.forEach((r, idx) => {
    const reg = {
      _line: idx + 2,
      nombre_categoria: pickSpreadsheetValue(r, ["nombre_categoria", "categoria", "nombre"]),
      activo: pickSpreadsheetValue(r, ["activo", "estado"]),
    };
    if (!Object.values(reg).some((x) => String(x || "").trim() !== "")) return;
    rows.push(reg);
  });
  return { rows, errors: [] };
}

async function importarCategoriasCsv(file, delimiter) {
  const parsed = await parseImportFile(file, delimiter, parseCategoriasCsv, parseCategoriasSpreadsheet);
  if (parsed.errors.length) {
    showEntToast(parsed.errors.join(" "), "bad");
    return;
  }
  if (!parsed.rows.length) {
    showEntToast("No hay filas validas para importar categorias.", "bad");
    return;
  }

  const created = [];
  const failed = [];
  for (const row of parsed.rows) {
    const line = Number(row._line || 0);
    const nombre_categoria = String(row.nombre_categoria || "").trim();
    const activo = parseActivoImport(row.activo);
    if (!nombre_categoria) {
      failed.push({ line, reason: "nombre_categoria es obligatorio." });
      continue;
    }
    if (activo === null) {
      failed.push({ line, reason: "Valor de activo invalido (usa 1/0, si/no)." });
      continue;
    }
    try {
      const r = await fetch("/api/categorias", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ nombre_categoria, activo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        failed.push({ line, reason: j.error || "Error al guardar categoria." });
        continue;
      }
      created.push({ line, id: j.id_categoria });
    } catch {
      failed.push({ line, reason: "Error de red al guardar." });
    }
  }

  if (created.length && !failed.length) {
    showEntToast(`Importacion completada: ${created.length} categorias.`, "ok");
  } else if (created.length && failed.length) {
    showEntToast(`Importacion parcial: ${created.length} categorias creadas, ${failed.length} con error.`, "bad");
  } else {
    showEntToast("No se importo ninguna categoria.", "bad");
  }

  if (failed.length) {
    const detail = failed
      .slice(0, 15)
      .map((x) => `Fila ${x.line}: ${x.reason}`)
      .join("\n");
    showEntToast(`Errores de importacion: ${detail.replace(/\n/g, " | ")}${failed.length > 15 ? " | ..." : ""}`, "bad");
  }
}

function parseSubcategoriasCsv(text, delimiter = ",") {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((ln) => ln.trim().length > 0);
  if (!lines.length) return { rows: [], errors: ["El archivo CSV esta vacio."] };

  const headers = parseCsvFields(lines[0], delimiter).map(normalizeImportKey);
  const idx = (aliases) => {
    const k = aliases.find((x) => headers.includes(x)) || "";
    return k ? headers.indexOf(k) : -1;
  };
  const colNombre = idx(["nombre_subcategoria", "subcategoria", "nombre"]);
  const colCategoria = idx(["categoria", "nombre_categoria"]);
  const colIdCategoria = idx(["id_categoria", "categoria_id"]);
  const colActivo = idx(["activo", "estado"]);

  const errors = [];
  if (colNombre < 0) errors.push("Falta encabezado obligatorio: nombre_subcategoria.");
  if (colCategoria < 0 && colIdCategoria < 0) errors.push("Falta categoria o id_categoria.");
  if (errors.length) return { rows: [], errors };

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const vals = parseCsvFields(lines[i], delimiter);
    const get = (pos) => (pos >= 0 ? String(vals[pos] || "").trim() : "");
    const reg = {
      _line: i + 1,
      nombre_subcategoria: get(colNombre),
      categoria: get(colCategoria),
      id_categoria: get(colIdCategoria),
      activo: get(colActivo),
    };
    if (!Object.values(reg).some((x) => String(x || "").trim() !== "")) continue;
    rows.push(reg);
  }
  return { rows, errors: [] };
}

function parseSubcategoriasSpreadsheet(rowsIn) {
  const rowsSrc = Array.isArray(rowsIn) ? rowsIn : [];
  if (!rowsSrc.length) return { rows: [], errors: ["El archivo Excel esta vacio."] };

  const errors = [];
  if (!hasSpreadsheetHeader(rowsSrc, ["nombre_subcategoria", "subcategoria", "nombre"])) {
    errors.push("Falta encabezado obligatorio: nombre_subcategoria.");
  }
  if (
    !hasSpreadsheetHeader(rowsSrc, ["categoria", "nombre_categoria"]) &&
    !hasSpreadsheetHeader(rowsSrc, ["id_categoria", "categoria_id"])
  ) {
    errors.push("Falta categoria o id_categoria.");
  }
  if (errors.length) return { rows: [], errors };

  const rows = [];
  rowsSrc.forEach((r, idx) => {
    const reg = {
      _line: idx + 2,
      nombre_subcategoria: pickSpreadsheetValue(r, ["nombre_subcategoria", "subcategoria", "nombre"]),
      categoria: pickSpreadsheetValue(r, ["categoria", "nombre_categoria"]),
      id_categoria: pickSpreadsheetValue(r, ["id_categoria", "categoria_id"]),
      activo: pickSpreadsheetValue(r, ["activo", "estado"]),
    };
    if (!Object.values(reg).some((x) => String(x || "").trim() !== "")) return;
    rows.push(reg);
  });
  return { rows, errors: [] };
}

async function importarSubcategoriasCsv(file, delimiter) {
  const parsed = await parseImportFile(file, delimiter, parseSubcategoriasCsv, parseSubcategoriasSpreadsheet);
  if (parsed.errors.length) {
    showEntToast(parsed.errors.join(" "), "bad");
    return;
  }
  if (!parsed.rows.length) {
    showEntToast("No hay filas validas para importar subcategorias.", "bad");
    return;
  }

  const catR = await fetch("/api/categorias?all=1", { headers: { Authorization: "Bearer " + token } });
  const categorias = await catR.json().catch(() => []);
  if (!catR.ok) {
    showEntToast("No se pudo cargar el catalogo de categorias.", "bad");
    return;
  }

  const mapCatByName = new Map();
  categorias.forEach((c) => {
    const key = normalizeImportKey(c.nombre_categoria);
    if (!key) return;
    if (!mapCatByName.has(key)) mapCatByName.set(key, []);
    mapCatByName.get(key).push(Number(c.id_categoria || 0));
  });

  const created = [];
  const failed = [];
  for (const row of parsed.rows) {
    const line = Number(row._line || 0);
    const nombre_subcategoria = String(row.nombre_subcategoria || "").trim();
    const id_categoria_num = Number(row.id_categoria || 0);
    const activo = parseActivoImport(row.activo);

    let id_categoria = id_categoria_num > 0 ? id_categoria_num : 0;
    if (!id_categoria && row.categoria) {
      const hits = mapCatByName.get(normalizeImportKey(row.categoria)) || [];
      if (hits.length === 1) id_categoria = Number(hits[0] || 0);
      if (hits.length > 1) {
        failed.push({ line, reason: "Categoria ambigua, usa id_categoria." });
        continue;
      }
    }

    if (!nombre_subcategoria) {
      failed.push({ line, reason: "nombre_subcategoria es obligatorio." });
      continue;
    }
    if (!id_categoria) {
      failed.push({ line, reason: "No se encontro categoria valida (usa categoria o id_categoria)." });
      continue;
    }
    if (activo === null) {
      failed.push({ line, reason: "Valor de activo invalido (usa 1/0, si/no)." });
      continue;
    }

    try {
      const r = await fetch("/api/subcategorias", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ id_categoria, nombre_subcategoria, activo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        failed.push({ line, reason: j.error || "Error al guardar subcategoria." });
        continue;
      }
      created.push({ line, id: j.id_subcategoria });
    } catch {
      failed.push({ line, reason: "Error de red al guardar." });
    }
  }

  if (created.length && !failed.length) {
    showEntToast(`Importacion completada: ${created.length} subcategorias.`, "ok");
  } else if (created.length && failed.length) {
    showEntToast(`Importacion parcial: ${created.length} subcategorias creadas, ${failed.length} con error.`, "bad");
  } else {
    showEntToast("No se importo ninguna subcategoria.", "bad");
  }

  if (failed.length) {
    const detail = failed
      .slice(0, 15)
      .map((x) => `Fila ${x.line}: ${x.reason}`)
      .join("\n");
    showEntToast(`Errores de importacion: ${detail.replace(/\n/g, " | ")}${failed.length > 15 ? " | ..." : ""}`, "bad");
  }
}

function parseProveedoresCsv(text, delimiter = ",") {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((ln) => ln.trim().length > 0);
  if (!lines.length) return { rows: [], errors: ["El archivo CSV esta vacio."] };

  const headers = parseCsvFields(lines[0], delimiter).map(normalizeImportKey);
  const idx = (aliases) => {
    const k = aliases.find((x) => headers.includes(x)) || "";
    return k ? headers.indexOf(k) : -1;
  };
  const colNombre = idx(["nombre_proveedor", "proveedor", "nombre"]);
  const colTelefono = idx(["telefono", "telefono_proveedor"]);
  const colDireccion = idx(["direccion"]);
  const colActivo = idx(["activo", "estado"]);

  const errors = [];
  if (colNombre < 0) errors.push("Falta encabezado obligatorio: nombre_proveedor.");
  if (errors.length) return { rows: [], errors };

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const vals = parseCsvFields(lines[i], delimiter);
    const get = (pos) => (pos >= 0 ? String(vals[pos] || "").trim() : "");
    const reg = {
      _line: i + 1,
      nombre_proveedor: get(colNombre),
      telefono: get(colTelefono),
      direccion: get(colDireccion),
      activo: get(colActivo),
    };
    if (!Object.values(reg).some((x) => String(x || "").trim() !== "")) continue;
    rows.push(reg);
  }
  return { rows, errors: [] };
}

function parseProveedoresSpreadsheet(rowsIn) {
  const rowsSrc = Array.isArray(rowsIn) ? rowsIn : [];
  if (!rowsSrc.length) return { rows: [], errors: ["El archivo Excel esta vacio."] };
  if (!hasSpreadsheetHeader(rowsSrc, ["nombre_proveedor", "proveedor", "nombre"])) {
    return { rows: [], errors: ["Falta encabezado obligatorio: nombre_proveedor."] };
  }
  const rows = [];
  rowsSrc.forEach((r, idx) => {
    const reg = {
      _line: idx + 2,
      nombre_proveedor: pickSpreadsheetValue(r, ["nombre_proveedor", "proveedor", "nombre"]),
      telefono: pickSpreadsheetValue(r, ["telefono", "telefono_proveedor"]),
      direccion: pickSpreadsheetValue(r, ["direccion"]),
      activo: pickSpreadsheetValue(r, ["activo", "estado"]),
    };
    if (!Object.values(reg).some((x) => String(x || "").trim() !== "")) return;
    rows.push(reg);
  });
  return { rows, errors: [] };
}

async function importarProveedoresCsv(file, delimiter) {
  const parsed = await parseImportFile(file, delimiter, parseProveedoresCsv, parseProveedoresSpreadsheet);
  if (parsed.errors.length) {
    showEntToast(parsed.errors.join(" "), "bad");
    return;
  }
  if (!parsed.rows.length) {
    showEntToast("No hay filas validas para importar proveedores.", "bad");
    return;
  }

  const created = [];
  const failed = [];
  for (const row of parsed.rows) {
    const line = Number(row._line || 0);
    const nombre_proveedor = String(row.nombre_proveedor || "").trim();
    const telefono = String(row.telefono || "").trim() || "";
    const direccion = String(row.direccion || "").trim() || "";
    const activo = parseActivoImport(row.activo);

    if (!nombre_proveedor) {
      failed.push({ line, reason: "nombre_proveedor es obligatorio." });
      continue;
    }
    if (activo === null) {
      failed.push({ line, reason: "Valor de activo invalido (usa 1/0, si/no)." });
      continue;
    }

    try {
      const r = await fetch("/api/proveedores", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ nombre_proveedor, telefono, direccion, activo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        failed.push({ line, reason: j.error || "Error al guardar proveedor." });
        continue;
      }
      created.push({ line, id: j.id_proveedor });
    } catch {
      failed.push({ line, reason: "Error de red al guardar." });
    }
  }

  if (created.length && !failed.length) {
    showEntToast(`Importacion completada: ${created.length} proveedores.`, "ok");
  } else if (created.length && failed.length) {
    showEntToast(`Importacion parcial: ${created.length} proveedores creados, ${failed.length} con error.`, "bad");
  } else {
    showEntToast("No se importo ningun proveedor.", "bad");
  }

  if (failed.length) {
    const detail = failed
      .slice(0, 15)
      .map((x) => `Fila ${x.line}: ${x.reason}`)
      .join("\n");
    showEntToast(`Errores de importacion: ${detail.replace(/\n/g, " | ")}${failed.length > 15 ? " | ..." : ""}`, "bad");
  }
}

function parseStockCsv(text, delimiter = ",") {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((ln) => ln.trim().length > 0);
  if (!lines.length) return { rows: [], errors: ["El archivo CSV esta vacio."] };

  const headers = parseCsvFields(lines[0], delimiter).map(normalizeImportKey);
  const idx = (aliases) => {
    const k = aliases.find((x) => headers.includes(x)) || "";
    return k ? headers.indexOf(k) : -1;
  };

  const colIdProducto = idx(["id_producto", "producto_id"]);
  const colSku = idx(["sku"]);
  const colNombre = idx(["nombre_producto", "producto", "nombre"]);
  const colLote = idx(["lote"]);
  const colCad = idx(["caducidad", "fecha_vencimiento", "vencimiento"]);
  const colCantidad = idx(["cantidad", "qty"]);
  const colPrecio = idx(["precio", "costo_unitario", "costo"]);
  const colObs = idx(["observacion_linea", "observacion", "nota"]);

  const errors = [];
  if (colIdProducto < 0 && colSku < 0 && colNombre < 0) {
    errors.push("Debes incluir id_producto, sku o nombre_producto.");
  }
  if (colCantidad < 0) errors.push("Falta encabezado obligatorio: cantidad.");
  if (errors.length) return { rows: [], errors };

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const vals = parseCsvFields(lines[i], delimiter);
    const get = (pos) => (pos >= 0 ? String(vals[pos] || "").trim() : "");
    const reg = {
      _line: i + 1,
      id_producto: get(colIdProducto),
      sku: get(colSku),
      nombre_producto: get(colNombre),
      lote: get(colLote),
      caducidad: get(colCad),
      cantidad: get(colCantidad),
      precio: get(colPrecio),
      observacion_linea: get(colObs),
    };
    if (!Object.values(reg).some((x) => String(x || "").trim() !== "")) continue;
    rows.push(reg);
  }
  return { rows, errors: [] };
}

function parseStockSpreadsheet(rowsIn) {
  const rowsSrc = Array.isArray(rowsIn) ? rowsIn : [];
  if (!rowsSrc.length) return { rows: [], errors: ["El archivo Excel esta vacio."] };
  const errors = [];
  if (
    !hasSpreadsheetHeader(rowsSrc, ["id_producto", "producto_id"]) &&
    !hasSpreadsheetHeader(rowsSrc, ["sku"]) &&
    !hasSpreadsheetHeader(rowsSrc, ["nombre_producto", "producto", "nombre"])
  ) {
    errors.push("Debes incluir id_producto, sku o nombre_producto.");
  }
  if (!hasSpreadsheetHeader(rowsSrc, ["cantidad", "qty"])) {
    errors.push("Falta encabezado obligatorio: cantidad.");
  }
  if (errors.length) return { rows: [], errors };

  const rows = [];
  rowsSrc.forEach((r, idx) => {
    const reg = {
      _line: idx + 2,
      id_producto: pickSpreadsheetValue(r, ["id_producto", "producto_id"]),
      sku: pickSpreadsheetValue(r, ["sku"]),
      nombre_producto: pickSpreadsheetValue(r, ["nombre_producto", "producto", "nombre"]),
      lote: pickSpreadsheetValue(r, ["lote"]),
      caducidad: pickSpreadsheetValue(r, ["caducidad", "fecha_vencimiento", "vencimiento"]),
      cantidad: pickSpreadsheetValue(r, ["cantidad", "qty"]),
      precio: pickSpreadsheetValue(r, ["precio", "costo_unitario", "costo"]),
      observacion_linea: pickSpreadsheetValue(r, ["observacion_linea", "observacion", "nota"]),
    };
    if (!Object.values(reg).some((x) => String(x || "").trim() !== "")) return;
    rows.push(reg);
  });
  return { rows, errors: [] };
}

async function importarStockCsv(file, delimiter) {
  const id_motivo = Number($("#prdStockImportMotivo")?.value || 0);
  if (!id_motivo) {
    showEntToast("Selecciona un motivo para la importacion de stock.", "bad");
    markError($("#prdStockImportMotivo"));
    return;
  }

  const parsed = await parseImportFile(file, delimiter, parseStockCsv, parseStockSpreadsheet);
  if (parsed.errors.length) {
    showEntToast(parsed.errors.join(" "), "bad");
    return;
  }
  if (!parsed.rows.length) {
    showEntToast("No hay filas validas para importar stock.", "bad");
    return;
  }

  const prdR = await fetch("/api/productos?all=1&limit=5000", {
    headers: { Authorization: "Bearer " + token },
  });
  const productos = await prdR.json().catch(() => []);
  if (!prdR.ok) {
    showEntToast("No se pudo cargar el catalogo de productos.", "bad");
    return;
  }

  const byId = new Map();
  const bySku = new Map();
  const byName = new Map();
  productos.forEach((p) => {
    const id = Number(p.id_producto || 0);
    if (id > 0) byId.set(id, p);
    const skuK = normalizeImportKey(p.sku);
    if (skuK) bySku.set(skuK, p);
    const nameK = normalizeImportKey(p.nombre_producto);
    if (!nameK) return;
    if (!byName.has(nameK)) byName.set(nameK, []);
    byName.get(nameK).push(p);
  });

  const failed = [];
  const lines = [];
  for (const row of parsed.rows) {
    const lineNo = Number(row._line || 0);
    let p = null;
    const id = Number(row.id_producto || 0);
    if (id > 0) p = byId.get(id) || null;
    if (!p && row.sku) p = bySku.get(normalizeImportKey(row.sku)) || null;
    if (!p && row.nombre_producto) {
      const hits = byName.get(normalizeImportKey(row.nombre_producto)) || [];
      if (hits.length === 1) p = hits[0];
      if (hits.length > 1) {
        failed.push({ line: lineNo, reason: "Nombre de producto ambiguo, usa SKU o ID." });
        continue;
      }
    }
    if (!p) {
      failed.push({ line: lineNo, reason: "Producto no encontrado (id/sku/nombre)." });
      continue;
    }

    const cantidad = Number(row.cantidad || 0);
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      failed.push({ line: lineNo, reason: "Cantidad invalida." });
      continue;
    }
    const precio = Number(row.precio || 0);
    if (!Number.isFinite(precio) || precio < 0) {
      failed.push({ line: lineNo, reason: "Precio invalido." });
      continue;
    }

    lines.push({
      id_producto: Number(p.id_producto),
      lote: row.lote || null,
      caducidad: row.caducidad || null,
      cantidad,
      precio,
      observacion_linea: row.observacion_linea || null,
    });
  }

  if (!lines.length) {
    showEntToast("No se pudo importar: todas las filas tienen errores.", "bad");
    if (failed.length) {
      const detail = failed.slice(0, 15).map((x) => `Fila ${x.line}: ${x.reason}`).join("\n");
      showEntToast(
        `Errores de importacion de stock: ${detail.replace(/\n/g, " | ")}${failed.length > 15 ? " | ..." : ""}`,
        "bad"
      );
    }
    return;
  }

  const payload = {
    id_motivo,
    id_proveedor: null,
    no_documento: `IMP-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "")}`,
    observaciones: $("#prdStockImportObs")?.value?.trim() || "Carga por importacion masiva de stock",
    pagado: null,
    lines,
  };

  let r = await fetch("/api/entradas", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify(payload),
  });
  let j = await r.json().catch(() => ({}));
  if (!r.ok && (j.code === "SENSITIVE_APPROVAL_REQUIRED" || j.code === "SUPERVISOR_PIN_REQUIRED")) {
    const ap = await promptSensitiveApproval("ajuste manual por importacion");
    if (!ap) {
      showEntToast("Importacion cancelada: falta validacion de supervisor.", "bad");
      return;
    }
    r = await fetch("/api/entradas", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ ...payload, ...ap }),
    });
    j = await r.json().catch(() => ({}));
  }
  if (!r.ok) {
    showEntToast(j.error || "Error guardando importacion de stock.", "bad");
    return;
  }
  showSupervisorAuthBadge(j.sensitive_approval);

  if (failed.length) {
    showEntToast(`Importacion parcial: ${lines.length} lineas procesadas, ${failed.length} con error.`, "bad");
    const detail = failed.slice(0, 15).map((x) => `Fila ${x.line}: ${x.reason}`).join("\n");
    showEntToast(
      `Errores de importacion de stock: ${detail.replace(/\n/g, " | ")}${failed.length > 15 ? " | ..." : ""}`,
      "bad"
    );
  } else {
    showEntToast(`Stock importado correctamente en entrada #${j.id_movimiento}.`, "ok");
  }
}

function parseLimitesCsv(text, delimiter = ",") {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((ln) => ln.trim().length > 0);
  if (!lines.length) return { rows: [], errors: ["El archivo CSV esta vacio."] };

  const headers = parseCsvFields(lines[0], delimiter).map(normalizeImportKey);
  const idx = (aliases) => {
    const k = aliases.find((x) => headers.includes(x)) || "";
    return k ? headers.indexOf(k) : -1;
  };

  const colIdBodega = idx(["id_bodega", "bodega_id"]);
  const colBodega = idx(["bodega", "nombre_bodega"]);
  const colIdProducto = idx(["id_producto", "producto_id"]);
  const colSku = idx(["sku"]);
  const colNombre = idx(["nombre_producto", "producto", "nombre"]);
  const colMin = idx(["minimo", "min"]);
  const colMax = idx(["maximo", "max"]);
  const colActivo = idx(["activo", "estado"]);

  const errors = [];
  if (colIdBodega < 0 && colBodega < 0) errors.push("Falta bodega o id_bodega.");
  if (colIdProducto < 0 && colSku < 0 && colNombre < 0) {
    errors.push("Falta id_producto, sku o nombre_producto.");
  }
  if (colMin < 0 && colMax < 0) errors.push("Falta minimo o maximo.");
  if (errors.length) return { rows: [], errors };

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const vals = parseCsvFields(lines[i], delimiter);
    const get = (pos) => (pos >= 0 ? String(vals[pos] || "").trim() : "");
    const reg = {
      _line: i + 1,
      id_bodega: get(colIdBodega),
      bodega: get(colBodega),
      id_producto: get(colIdProducto),
      sku: get(colSku),
      nombre_producto: get(colNombre),
      minimo: get(colMin),
      maximo: get(colMax),
      activo: get(colActivo),
    };
    if (!Object.values(reg).some((x) => String(x || "").trim() !== "")) continue;
    rows.push(reg);
  }
  return { rows, errors: [] };
}

function parseLimitesSpreadsheet(rowsIn) {
  const rowsSrc = Array.isArray(rowsIn) ? rowsIn : [];
  if (!rowsSrc.length) return { rows: [], errors: ["El archivo Excel esta vacio."] };

  const errors = [];
  if (!hasSpreadsheetHeader(rowsSrc, ["id_bodega", "bodega_id"]) && !hasSpreadsheetHeader(rowsSrc, ["bodega", "nombre_bodega"])) {
    errors.push("Falta bodega o id_bodega.");
  }
  if (
    !hasSpreadsheetHeader(rowsSrc, ["id_producto", "producto_id"]) &&
    !hasSpreadsheetHeader(rowsSrc, ["sku"]) &&
    !hasSpreadsheetHeader(rowsSrc, ["nombre_producto", "producto", "nombre"])
  ) {
    errors.push("Falta id_producto, sku o nombre_producto.");
  }
  if (!hasSpreadsheetHeader(rowsSrc, ["minimo", "min"]) && !hasSpreadsheetHeader(rowsSrc, ["maximo", "max"])) {
    errors.push("Falta minimo o maximo.");
  }
  if (errors.length) return { rows: [], errors };

  const rows = [];
  rowsSrc.forEach((r, idx) => {
    const reg = {
      _line: idx + 2,
      id_bodega: pickSpreadsheetValue(r, ["id_bodega", "bodega_id"]),
      bodega: pickSpreadsheetValue(r, ["bodega", "nombre_bodega"]),
      id_producto: pickSpreadsheetValue(r, ["id_producto", "producto_id"]),
      sku: pickSpreadsheetValue(r, ["sku"]),
      nombre_producto: pickSpreadsheetValue(r, ["nombre_producto", "producto", "nombre"]),
      minimo: pickSpreadsheetValue(r, ["minimo", "min"]),
      maximo: pickSpreadsheetValue(r, ["maximo", "max"]),
      activo: pickSpreadsheetValue(r, ["activo", "estado"]),
    };
    if (!Object.values(reg).some((x) => String(x || "").trim() !== "")) return;
    rows.push(reg);
  });
  return { rows, errors: [] };
}

async function importarLimitesCsv(file, delimiter) {
  const parsed = await parseImportFile(file, delimiter, parseLimitesCsv, parseLimitesSpreadsheet);
  if (parsed.errors.length) {
    showEntToast(parsed.errors.join(" "), "bad");
    return;
  }
  if (!parsed.rows.length) {
    showEntToast("No hay filas validas para importar limites.", "bad");
    return;
  }

  const [bodR, prdR] = await Promise.all([
    fetch("/api/bodegas?all=1", { headers: { Authorization: "Bearer " + token } }),
    fetch("/api/productos?all=1&limit=5000", { headers: { Authorization: "Bearer " + token } }),
  ]);
  const bodegas = await bodR.json().catch(() => []);
  const productos = await prdR.json().catch(() => []);
  if (!bodR.ok || !prdR.ok) {
    showEntToast("No se pudieron cargar catalogos para importar limites.", "bad");
    return;
  }

  const mapBodegaByName = new Map();
  const mapBodegaById = new Map();
  bodegas.forEach((b) => {
    const id = Number(b.id_bodega || 0);
    if (id > 0) mapBodegaById.set(id, b);
    const key = normalizeImportKey(b.nombre_bodega);
    if (!key) return;
    if (!mapBodegaByName.has(key)) mapBodegaByName.set(key, []);
    mapBodegaByName.get(key).push(id);
  });

  const mapProdById = new Map();
  const mapProdBySku = new Map();
  const mapProdByName = new Map();
  productos.forEach((p) => {
    const id = Number(p.id_producto || 0);
    if (id > 0) mapProdById.set(id, p);
    const skuKey = normalizeImportKey(p.sku);
    if (skuKey) mapProdBySku.set(skuKey, p);
    const nameKey = normalizeImportKey(p.nombre_producto);
    if (!nameKey) return;
    if (!mapProdByName.has(nameKey)) mapProdByName.set(nameKey, []);
    mapProdByName.get(nameKey).push(p);
  });

  const created = [];
  const failed = [];
  for (const row of parsed.rows) {
    const line = Number(row._line || 0);
    const id_bodega_num = Number(row.id_bodega || 0);
    const id_producto_num = Number(row.id_producto || 0);

    let id_bodega = id_bodega_num > 0 ? id_bodega_num : 0;
    if (!id_bodega && row.bodega) {
      const hits = mapBodegaByName.get(normalizeImportKey(row.bodega)) || [];
      if (hits.length === 1) id_bodega = Number(hits[0] || 0);
      if (hits.length > 1) {
        failed.push({ line, reason: "Bodega ambigua, usa id_bodega." });
        continue;
      }
    }

    let id_producto = id_producto_num > 0 ? id_producto_num : 0;
    if (!id_producto && row.sku) {
      const hit = mapProdBySku.get(normalizeImportKey(row.sku));
      id_producto = Number(hit?.id_producto || 0);
    }
    if (!id_producto && row.nombre_producto) {
      const hits = mapProdByName.get(normalizeImportKey(row.nombre_producto)) || [];
      if (hits.length === 1) id_producto = Number(hits[0]?.id_producto || 0);
      if (hits.length > 1) {
        failed.push({ line, reason: "Producto ambiguo, usa sku o id_producto." });
        continue;
      }
    }

    if (!id_bodega || !mapBodegaById.has(id_bodega)) {
      failed.push({ line, reason: "No se encontro bodega valida (usa bodega o id_bodega)." });
      continue;
    }
    if (!id_producto || !mapProdById.has(id_producto)) {
      failed.push({ line, reason: "No se encontro producto valido (usa id_producto, sku o nombre_producto)." });
      continue;
    }

    const hasMin = String(row.minimo || "").trim() !== "";
    const hasMax = String(row.maximo || "").trim() !== "";
    if (!hasMin && !hasMax) {
      failed.push({ line, reason: "Debes indicar minimo o maximo." });
      continue;
    }
    const minimo = hasMin ? Number(row.minimo) : 0;
    const maximo = hasMax ? Number(row.maximo) : 0;
    const activo = parseActivoImport(row.activo);

    if (!Number.isFinite(minimo) || minimo < 0) {
      failed.push({ line, reason: "Minimo invalido." });
      continue;
    }
    if (!Number.isFinite(maximo) || maximo < 0) {
      failed.push({ line, reason: "Maximo invalido." });
      continue;
    }
    if (maximo > 0 && minimo > maximo) {
      failed.push({ line, reason: "Minimo mayor que maximo." });
      continue;
    }
    if (activo === null) {
      failed.push({ line, reason: "Valor de activo invalido (usa 1/0, si/no)." });
      continue;
    }

    try {
      const r = await fetch("/api/limites", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ id_bodega, id_producto, minimo, maximo, activo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        failed.push({ line, reason: j.error || "Error guardando limite." });
        continue;
      }
      created.push({ line, key: `${id_bodega}|${id_producto}` });
    } catch {
      failed.push({ line, reason: "Error de red al guardar." });
    }
  }

  if (created.length && !failed.length) {
    showEntToast(`Importacion completada: ${created.length} limites.`, "ok");
  } else if (created.length && failed.length) {
    showEntToast(`Importacion parcial: ${created.length} limites guardados, ${failed.length} con error.`, "bad");
  } else {
    showEntToast("No se importo ningun limite.", "bad");
  }

  if (failed.length) {
    const detail = failed
      .slice(0, 15)
      .map((x) => `Fila ${x.line}: ${x.reason}`)
      .join("\n");
    showEntToast(`Errores de importacion: ${detail.replace(/\n/g, " | ")}${failed.length > 15 ? " | ..." : ""}`, "bad");
  }

  if (created.length) loadLimitesList();
}

function renderProductWarehouseChecklist(containerSelector, selectedIds = []) {
  const box = $(containerSelector);
  if (!box) return;
  const isEditMode = containerSelector === "#prdEditVisibleWarehouses";
  box.classList.remove("warehouseCheckList");
  box.classList.add("prdWarehouseMount");
  box.classList.toggle("is-edit-mode", isEditMode);
  const fieldWrap = box.closest(".grid2 > div, .grid3 > div, .grid4 > div, .uiField");
  fieldWrap?.classList.add("prdWarehouseField");
  const picked = new Set((Array.isArray(selectedIds) ? selectedIds : []).map((x) => Number(x || 0)));
  if (!prdVisibleWarehousesCatalog.length) {
    box.innerHTML = `<div class="warehouseCheckEmpty">No hay bodegas disponibles.</div>`;
    return;
  }
  const itemHtml = prdVisibleWarehousesCatalog
    .map(
      (b) => `
      <label class="warehouseCheckItem prdWhSwitchRow">
        <span class="prdWhName">${escapeHtml(b.nombre_bodega || `Bodega #${b.id_bodega}`)}</span>
        <span class="prdWhSwitch" title="Activar/desactivar bodega">
          <input class="prdWhSwitchInput" type="checkbox" data-prd-wh="${Number(b.id_bodega || 0)}" ${picked.has(Number(b.id_bodega || 0)) ? "checked" : ""} />
          <span class="prdWhSwitchSlider" aria-hidden="true"></span>
        </span>
      </label>
    `
    )
    .join("");
  const currentSearch = (box.querySelector("[data-prd-wh-search]")?.value || "").trim();
  const productName = escapeHtml($("#prdEditNombre")?.value?.trim() || "Producto seleccionado");
  const productSku = escapeHtml($("#prdEditSku")?.value?.trim() || "");
  const skuTag = productSku ? `<span class="pill ghost">SKU: ${productSku}</span>` : "";
  const toolsHtml = `
    <div class="prdWhEditorTools">
      <input class="in" type="text" data-prd-wh-search placeholder="Buscar bodega..." title="Escribe el nombre de bodega para filtrar la lista." value="${escapeHtml(currentSearch)}" />
      <button class="btn soft btn-sm" type="button" data-prd-wh-action="check-visible" title="Marca las bodegas que estan visibles en la lista filtrada.">Marcar visibles</button>
      <button class="btn soft btn-sm" type="button" data-prd-wh-action="uncheck-visible" title="Desmarca las bodegas visibles en la lista filtrada.">Limpiar visibles</button>
      <button class="btn soft btn-sm" type="button" data-prd-wh-action="only-mine" title="Deja seleccionada solo tu bodega asignada.">Solo mi bodega</button>
      <span class="note" data-prd-wh-counter></span>
    </div>
  `;

  if (!isEditMode) {
    box.innerHTML = `
      <div class="prdWhPicker">
        ${toolsHtml}
        <div class="warehouseCheckList prdWhEditorList" data-prd-wh-list>${itemHtml}</div>
      </div>
    `;
  } else {
    box.innerHTML = `
      <div class="prdWhEditor">
        <div class="prdWhEditorHead">
          <div class="prdWhEditorTitle">Habilitar en bodegas</div>
          <div class="prdWhEditorMeta">
            <span class="pill">${productName}</span>
            ${skuTag}
          </div>
        </div>
        ${toolsHtml}
        <div class="warehouseCheckList prdWhEditorList" data-prd-wh-list>${itemHtml}</div>
      </div>
    `;
  }

  const list = box.querySelector("[data-prd-wh-list]");
  const counter = box.querySelector("[data-prd-wh-counter]");
  const searchInput = box.querySelector("[data-prd-wh-search]");
  const updateCounter = () => {
    if (!list || !counter) return;
    const all = list.querySelectorAll("input[data-prd-wh]");
    const checked = list.querySelectorAll("input[data-prd-wh]:checked");
    counter.textContent = `${checked.length}/${all.length} bodegas habilitadas`;
  };
  const applyFilter = () => {
    if (!list || !searchInput) return;
    const q = String(searchInput.value || "").trim().toLowerCase();
    list.querySelectorAll(".warehouseCheckItem").forEach((row) => {
      const name = String(row.querySelector(".prdWhName")?.textContent || "").toLowerCase();
      row.style.display = !q || name.includes(q) ? "" : "none";
    });
  };
  const toggleVisibleRows = (checked) => {
    if (!list) return;
    list.querySelectorAll(".warehouseCheckItem").forEach((row) => {
      if (row.style.display === "none") return;
      const input = row.querySelector("input[data-prd-wh]");
      if (input) input.checked = checked;
    });
    updateCounter();
  };
  const selectOnlyMyWarehouse = () => {
    if (!list) return;
    const myWh = Number(me?.id_warehouse || 0);
    if (!myWh) {
      showEntToast("Tu usuario no tiene una bodega asignada.", "bad");
      return;
    }
    let found = false;
    list.querySelectorAll("input[data-prd-wh]").forEach((input) => {
      const currentId = Number(input.dataset.prdWh || 0);
      const isMine = currentId === myWh;
      input.checked = isMine;
      if (isMine) found = true;
    });
    if (!found) {
      showEntToast("Tu bodega no aparece en la lista de bodegas visibles.", "bad");
      return;
    }
    if (searchInput) searchInput.value = "";
    applyFilter();
    updateCounter();
  };

  list?.querySelectorAll("input[data-prd-wh]").forEach((input) => {
    input.addEventListener("change", updateCounter);
  });
  searchInput?.addEventListener("input", applyFilter);
  box.querySelectorAll("[data-prd-wh-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.getAttribute("data-prd-wh-action");
      if (action === "check-visible") toggleVisibleRows(true);
      if (action === "uncheck-visible") toggleVisibleRows(false);
      if (action === "only-mine") selectOnlyMyWarehouse();
    });
  });
  applyFilter();
  updateCounter();
}

function getSelectedProductWarehouseIds(containerSelector) {
  const box = $(containerSelector);
  if (!box) return [];
  return Array.from(box.querySelectorAll("input[data-prd-wh]:checked"))
    .map((it) => Number(it.dataset.prdWh || 0))
    .filter((id) => Number.isInteger(id) && id > 0);
}

function productWarehouseSummaryLabel(productRow) {
  const total = Number(productRow?.total_bodegas_visibles || 0);
  const names = String(productRow?.nombres_bodegas_visibles || "").trim();
  if (total <= 0) {
    return `<span class="pill ghost" title="Disponible para todas las bodegas">Todas</span>`;
  }
  const tooltip = names || "Sin detalle de bodegas";
  if (total === 1) return `<span class="pill ghost" title="${escapeHtml(tooltip)}">1 bodega</span>`;
  return `<span class="pill ghost" title="${escapeHtml(tooltip)}">${total} bodegas</span>`;
}

function productWarehouseOwnStatusTag(productRow) {
  return Number(productRow?.visible_en_bodega_usuario)
    ? `<span class="badgeTag ok">Habilitado</span>`
    : `<span class="badgeTag warn">Inhabilitado</span>`;
}

function getMyProductWarehouseName() {
  const idWarehouse = Number(me?.id_warehouse || 0);
  if (!idWarehouse) return "tu bodega";
  const found = prdVisibleWarehousesCatalog.find((b) => Number(b.id_bodega || 0) === idWarehouse);
  return found?.nombre_bodega || `Bodega #${idWarehouse}`;
}

function syncMyProductWarehouseUI() {
  const check = $("#prdVisibleInMyWarehouse");
  const wrap = $("#prdMyWarehouseToggleWrap");
  const hint = $("#prdMyWarehouseHint");
  const idWarehouse = Number(me?.id_warehouse || 0);
  if (!check || !wrap || !hint) return;
  if (!idWarehouse) {
    check.checked = true;
    check.disabled = true;
    wrap.style.display = "none";
    hint.textContent = "La visibilidad por mi bodega requiere que el usuario tenga una bodega asignada.";
    return;
  }
  check.disabled = false;
  wrap.style.display = "";
  if (!check.dataset.userTouched) check.checked = true;
  hint.textContent = `Tu bodega actual es ${getMyProductWarehouseName()}. Tambien puedes cambiar este estado luego desde la lista.`;
}

async function toggleProductVisibilityInMyWarehouse(idProducto, visible) {
  const id_producto = Number(idProducto || 0);
  if (!id_producto) return { ok: false, error: "Producto invalido" };
  const r = await fetch(`/api/productos/${id_producto}/visibilidad-mi-bodega`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({ visible: visible ? 1 : 0 }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, error: j.error || "No se pudo actualizar la visibilidad." };
  return { ok: true, data: j };
}

async function loadProductoWarehouseOptions(force = false) {
  if (prdVisibleWarehousesCatalog.length && !force) {
    renderProductWarehouseChecklist("#prdVisibleWarehouses");
    renderProductWarehouseChecklist("#prdEditVisibleWarehouses");
    syncMyProductWarehouseUI();
    return;
  }
  try {
    const r = await fetch("/api/bodegas?all=1", {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) return;
    prdVisibleWarehousesCatalog = Array.isArray(rows) ? rows : [];
    renderProductWarehouseChecklist("#prdVisibleWarehouses");
    renderProductWarehouseChecklist("#prdEditVisibleWarehouses");
    syncMyProductWarehouseUI();
  } catch (e) { console.error('api_motivos:', e); }
}

async function loadProductVisibleWarehouses(idProducto, containerSelector) {
  await loadProductoWarehouseOptions();
  const id_producto = Number(idProducto || 0);
  if (!id_producto) {
    renderProductWarehouseChecklist(containerSelector, []);
    return;
  }
  try {
    const r = await fetch(`/api/productos/${id_producto}/bodegas-visibles`, {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      renderProductWarehouseChecklist(containerSelector, []);
      return;
    }
    renderProductWarehouseChecklist(containerSelector, Array.isArray(j.ids) ? j.ids : []);
  } catch {
    renderProductWarehouseChecklist(containerSelector, []);
  }
}

async function loadProductosManage() {
  const tb = $("#prdManageList");
  if (!tb) return;
  const q = ($("#prdSearch")?.value || "").trim();
  const isSearch = q.length > 0;
  tb.innerHTML = `<tr><td colspan="10">${isSearch ? "Buscando..." : "Cargando productos..."}</td></tr>`;
  try {
    const qs = new URLSearchParams({ all: "1", limit: isSearch ? "40" : "25" });
    if (isSearch) qs.set("q", q);
    const r = await fetch(`/api/productos?${qs.toString()}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) {
      tb.innerHTML = `<tr><td colspan="10">Error al cargar productos</td></tr>`;
      return;
    }
    if (!rows.length) {
      tb.innerHTML = `<tr><td colspan="10">${isSearch ? "Sin productos para esa busqueda" : "Sin productos para mostrar"}</td></tr>`;
      return;
    }
    const canToggleMine = Number(me?.id_warehouse || 0) > 0;
    tb.innerHTML = rows
      .map(
        (p) => `
        <tr>
          <td>${p.id_producto}</td>
          <td>${p.nombre_producto || ""}</td>
          <td>${p.sku || ""}</td>
          <td>${p.nombre_medida || "-"}</td>
          <td>${p.nombre_categoria || "-"}</td>
          <td>${p.nombre_subcategoria || "-"}</td>
          <td>${productWarehouseSummaryLabel(p)}</td>
          <td>${canToggleMine ? productWarehouseOwnStatusTag(p) : `<span class="note">Sin bodega</span>`}</td>
          <td>${productoEstadoTag(p.activo)}</td>
          <td>
            <div class="gridActions">
              ${canToggleMine ? `<button class="iconBtn ${Number(p.visible_en_bodega_usuario) ? "del" : "ok"}" data-ptoggle="${p.id_producto}" data-next-visible="${Number(p.visible_en_bodega_usuario) ? 0 : 1}" title="${Number(p.visible_en_bodega_usuario) ? "Inhabilitar en mi bodega" : "Habilitar en mi bodega"}">${Number(p.visible_en_bodega_usuario) ? "X" : "H"}</button>` : ""}
              <button class="iconBtn edit" data-pedit="${p.id_producto}" title="Editar">E</button>
            </div>
          </td>
        </tr>
      `
      )
      .join("");

    tb.querySelectorAll("[data-pedit]").forEach((btn) => {
      btn.onclick = async () => {
        const id = Number(btn.dataset.pedit || 0);
        const p = rows.find((x) => Number(x.id_producto) === id);
        if (!p) return;
        $("#prdEditId").value = String(p.id_producto);
        $("#prdEditNombre").value = p.nombre_producto || "";
        $("#prdEditSku").value = p.sku || "";
        $("#prdEditActivo").value = Number(p.activo) ? "1" : "0";
        $("#prdEditMedida").value = p.id_medida ? String(p.id_medida) : "";
        $("#prdEditCategoria").value = p.id_categoria ? String(p.id_categoria) : "";
        await loadSubcategoriasProducto(p.id_categoria, "#prdEditSubcategoria", p.id_subcategoria || "");
        await loadProductVisibleWarehouses(p.id_producto, "#prdEditVisibleWarehouses");
        openAdminCollapseSection('view-productos', 'Editar producto');
      };
    });

    tb.querySelectorAll("[data-ptoggle]").forEach((btn) => {
      btn.onclick = async () => {
        const id = Number(btn.dataset.ptoggle || 0);
        const nextVisible = Number(btn.dataset.nextVisible || 0) === 1;
        if (!id) return;
        const actionLabel = nextVisible ? "habilitar" : "inhabilitar";
        if (!(await uiConfirm(`Deseas ${actionLabel} este producto en ${getMyProductWarehouseName()}?`, `${nextVisible ? "Habilitar" : "Inhabilitar"} producto`))) return;
        const result = await toggleProductVisibilityInMyWarehouse(id, nextVisible);
        if (!result.ok) {
          showEntToast(result.error || "No se pudo actualizar la visibilidad.", "bad");
          return;
        }
        showEntToast(`Producto ${nextVisible ? "habilitado" : "inhabilitado"} en ${getMyProductWarehouseName()}.`, "ok");
        loadProductosManage();
      };
    });
  } catch {
    tb.innerHTML = `<tr><td colspan="10">Error de red</td></tr>`;
  }
}

if ($("#prdCategoria")) {
  $("#prdCategoria").addEventListener("change", () => {
    const idCategoria = Number($("#prdCategoria")?.value || 0);
    loadSubcategoriasProducto(idCategoria, "#prdSubcategoria");
  });
}

if ($("#prdVisibleInMyWarehouse")) {
  $("#prdVisibleInMyWarehouse").addEventListener("change", () => {
    $("#prdVisibleInMyWarehouse").dataset.userTouched = "1";
  });
}

if ($("#prdEditCategoria")) {
  $("#prdEditCategoria").addEventListener("change", () => {
    const idCategoria = Number($("#prdEditCategoria")?.value || 0);
    loadSubcategoriasProducto(idCategoria, "#prdEditSubcategoria");
  });
}

if ($("#prdSave")) {
  $("#prdSave").onclick = async () => {
    const nombre_producto = $("#prdNombre")?.value?.trim() || "";
    const sku = $("#prdSku")?.value?.trim() || null;
    const id_medida = Number($("#prdMedida")?.value || 0);
    const id_categoria = Number($("#prdCategoria")?.value || 0);
    const id_subcategoria = Number($("#prdSubcategoria")?.value || 0) || null;
    const activo = Number($("#prdActivo")?.value || 1);
    const id_bodegas_visibles = getSelectedProductWarehouseIds("#prdVisibleWarehouses");
    const visibleInMyWarehouse = $("#prdVisibleInMyWarehouse") ? $("#prdVisibleInMyWarehouse").checked : true;

    if (!nombre_producto) {
      showEntToast("El nombre del producto es obligatorio.", "bad");
      markError($("#prdNombre"));
      return;
    }
    if (!id_medida) {
      showEntToast("Selecciona la medida.", "bad");
      markError($("#prdMedida"));
      return;
    }
    if (!id_categoria) {
      showEntToast("Selecciona la categoria.", "bad");
      markError($("#prdCategoria"));
      return;
    }

    try {
      const r = await fetch("/api/productos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          nombre_producto,
          sku,
          id_medida,
          id_categoria,
          id_subcategoria,
          activo,
          id_bodegas_visibles,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        showEntToast(j.error || "Error guardando producto.", "bad");
        return;
      }
      if (!visibleInMyWarehouse && Number(me?.id_warehouse || 0) > 0) {
        const toggleResult = await toggleProductVisibilityInMyWarehouse(j.id_producto, false);
        if (!toggleResult.ok) {
          showEntToast(toggleResult.error || "El producto se creo, pero no se pudo inhabilitar en tu bodega.", "bad");
        }
      }
      showEntToast(`Producto creado #${j.id_producto}`, "ok");
      $("#prdNombre").value = "";
      $("#prdSku").value = "";
      $("#prdMedida").value = "";
      $("#prdCategoria").value = "";
      $("#prdSubcategoria").innerHTML = `<option value="">Seleccione subcategoria</option>`;
      $("#prdActivo").value = "1";
      renderProductWarehouseChecklist("#prdVisibleWarehouses", []);
      if ($("#prdVisibleInMyWarehouse")) {
        $("#prdVisibleInMyWarehouse").checked = true;
        delete $("#prdVisibleInMyWarehouse").dataset.userTouched;
      }
      syncMyProductWarehouseUI();
      loadProductosManage();
    } catch {
      showEntToast("Error de red.", "bad");
    }
  };
}

if ($("#prdImportBtn")) {
  $("#prdImportBtn").onclick = async () => {
    const file = $("#prdImportFile")?.files?.[0] || null;
    const delimiter = $("#prdImportDelimiter")?.value || ",";
    if (!file) {
      showEntToast("Selecciona un archivo CSV para importar.", "bad");
      markError($("#prdImportFile"));
      return;
    }
    if (!/\.(csv|xlsx|xls)$/i.test(file.name || "")) {
      showEntToast("El archivo debe ser CSV o Excel (.csv, .xlsx, .xls).", "bad");
      markError($("#prdImportFile"));
      return;
    }

    try {
      await importarProductosCsv(file, delimiter);
      if ($("#prdImportFile")) $("#prdImportFile").value = "";
      if ($("#prdImportFileName")) $("#prdImportFileName").textContent = "Ningun archivo seleccionado";
      loadProductosManage();
    } catch {
      showEntToast("Error procesando el archivo.", "bad");
    }
  };
}

if ($("#prdTemplateBtn")) {
  $("#prdTemplateBtn").onclick = () => {
    const csv =
      "nombre_producto,sku,medida,categoria,subcategoria,activo\n" +
      "Arroz premium,ARZ-001,Unidad,Granos,Basicos,1\n" +
      "Azucar blanca,AZC-002,Unidad,Endulzantes,,1\n";
    downloadCsvTemplate("plantilla_productos.csv", csv);
  };
}

if ($("#prdStockTemplateBtn")) {
  $("#prdStockTemplateBtn").onclick = () => {
    const csv =
      "sku,lote,caducidad,cantidad,precio,observacion_linea\n" +
      "ARZ-001,LOT-ARZ-001,2027-12-31,50,12.50,Carga inicial\n" +
      "AZC-002,LOT-AZC-002,2028-01-15,30,10.00,Compra febrero\n";
    downloadCsvTemplate("plantilla_stock.csv", csv);
  };
}

if ($("#catTemplateBtn")) {
  $("#catTemplateBtn").onclick = () => {
    const csv =
      "nombre_categoria,activo\n" +
      "Granos,1\n" +
      "Endulzantes,1\n";
    downloadCsvTemplate("plantilla_categorias.csv", csv);
  };
}

if ($("#subCatTemplateBtn")) {
  $("#subCatTemplateBtn").onclick = () => {
    const csv =
      "nombre_subcategoria,categoria,activo\n" +
      "Basicos,Granos,1\n" +
      "Refinados,Endulzantes,1\n";
    downloadCsvTemplate("plantilla_subcategorias.csv", csv);
  };
}

if ($("#provTemplateBtn")) {
  $("#provTemplateBtn").onclick = () => {
    const csv =
      "nombre_proveedor,telefono,direccion,activo\n" +
      "Distribuidora Central,5555-1111,Zona 1,1\n" +
      "Bodega Norte,5555-2222,Zona 7,1\n";
    downloadCsvTemplate("plantilla_proveedores.csv", csv);
  };
}

if ($("#limTemplateBtn")) {
  $("#limTemplateBtn").onclick = () => {
    const csv =
      "id_bodega,sku,minimo,maximo,activo\n" +
      "1,ARZ-001,10,30,1\n" +
      "1,AZC-002,5,20,1\n";
    downloadCsvTemplate("plantilla_minimos_maximos.csv", csv);
  };
}

if ($("#prdImportFile")) {
  $("#prdImportFile").addEventListener("change", () => {
    const file = $("#prdImportFile")?.files?.[0] || null;
    if ($("#prdImportFileName")) $("#prdImportFileName").textContent = file ? file.name : "Ningun archivo seleccionado";
  });
}

if ($("#catImportFile")) {
  $("#catImportFile").addEventListener("change", () => {
    const file = $("#catImportFile")?.files?.[0] || null;
    if ($("#catImportFileName")) $("#catImportFileName").textContent = file ? file.name : "Ningun archivo seleccionado";
  });
}

if ($("#subCatImportFile")) {
  $("#subCatImportFile").addEventListener("change", () => {
    const file = $("#subCatImportFile")?.files?.[0] || null;
    if ($("#subCatImportFileName")) $("#subCatImportFileName").textContent = file ? file.name : "Ningun archivo seleccionado";
  });
}

if ($("#provImportFile")) {
  $("#provImportFile").addEventListener("change", () => {
    const file = $("#provImportFile")?.files?.[0] || null;
    if ($("#provImportFileName")) $("#provImportFileName").textContent = file ? file.name : "Ningun archivo seleccionado";
  });
}

if ($("#prdStockImportFile")) {
  $("#prdStockImportFile").addEventListener("change", () => {
    const file = $("#prdStockImportFile")?.files?.[0] || null;
    if ($("#prdStockImportFileName")) $("#prdStockImportFileName").textContent = file ? file.name : "Ningun archivo seleccionado";
  });
}

if ($("#limImportFile")) {
  $("#limImportFile").addEventListener("change", () => {
    const file = $("#limImportFile")?.files?.[0] || null;
    if ($("#limImportFileName")) $("#limImportFileName").textContent = file ? file.name : "Ningun archivo seleccionado";
  });
}

if ($("#prdStockImportBtn")) {
  $("#prdStockImportBtn").onclick = async () => {
    const file = $("#prdStockImportFile")?.files?.[0] || null;
    const delimiter = $("#prdStockImportDelimiter")?.value || ",";
    if (!file) {
      showEntToast("Selecciona un archivo CSV para importar stock.", "bad");
      markError($("#prdStockImportFile"));
      return;
    }
    if (!/\.(csv|xlsx|xls)$/i.test(file.name || "")) {
      showEntToast("El archivo de stock debe ser CSV o Excel (.csv, .xlsx, .xls).", "bad");
      markError($("#prdStockImportFile"));
      return;
    }
    try {
      await loadMotivosEntrada();
      await importarStockCsv(file, delimiter);
      if ($("#prdStockImportFile")) $("#prdStockImportFile").value = "";
      if ($("#prdStockImportFileName")) $("#prdStockImportFileName").textContent = "Ningun archivo seleccionado";
      if ($("#prdStockImportObs")) $("#prdStockImportObs").value = "";
    } catch {
      showEntToast("Error procesando importacion de stock.", "bad");
    }
  };
}

if ($("#catImportBtn")) {
  $("#catImportBtn").onclick = async () => {
    const file = $("#catImportFile")?.files?.[0] || null;
    const delimiter = $("#catImportDelimiter")?.value || ",";
    if (!file) {
      showEntToast("Selecciona un archivo CSV para importar categorias.", "bad");
      markError($("#catImportFile"));
      return;
    }
    if (!/\.(csv|xlsx|xls)$/i.test(file.name || "")) {
      showEntToast("El archivo de categorias debe ser CSV o Excel (.csv, .xlsx, .xls).", "bad");
      markError($("#catImportFile"));
      return;
    }
    try {
      await importarCategoriasCsv(file, delimiter);
      if ($("#catImportFile")) $("#catImportFile").value = "";
      if ($("#catImportFileName")) $("#catImportFileName").textContent = "Ningun archivo seleccionado";
      loadCategoriasManage();
      prdCatalogosLoaded = false;
      subcatCatalogosLoaded = false;
    } catch {
      showEntToast("Error procesando importacion de categorias.", "bad");
    }
  };
}

if ($("#subCatImportBtn")) {
  $("#subCatImportBtn").onclick = async () => {
    const file = $("#subCatImportFile")?.files?.[0] || null;
    const delimiter = $("#subCatImportDelimiter")?.value || ",";
    if (!file) {
      showEntToast("Selecciona un archivo CSV para importar subcategorias.", "bad");
      markError($("#subCatImportFile"));
      return;
    }
    if (!/\.(csv|xlsx|xls)$/i.test(file.name || "")) {
      showEntToast("El archivo de subcategorias debe ser CSV o Excel (.csv, .xlsx, .xls).", "bad");
      markError($("#subCatImportFile"));
      return;
    }
    try {
      await importarSubcategoriasCsv(file, delimiter);
      if ($("#subCatImportFile")) $("#subCatImportFile").value = "";
      if ($("#subCatImportFileName")) $("#subCatImportFileName").textContent = "Ningun archivo seleccionado";
      loadSubcategoriasManage();
      prdCatalogosLoaded = false;
      regCatalogosLoaded = false;
    } catch {
      showEntToast("Error procesando importacion de subcategorias.", "bad");
    }
  };
}

if ($("#provImportBtn")) {
  $("#provImportBtn").onclick = async () => {
    const file = $("#provImportFile")?.files?.[0] || null;
    const delimiter = $("#provImportDelimiter")?.value || ",";
    if (!file) {
      showEntToast("Selecciona un archivo CSV para importar proveedores.", "bad");
      markError($("#provImportFile"));
      return;
    }
    if (!/\.(csv|xlsx|xls)$/i.test(file.name || "")) {
      showEntToast("El archivo de proveedores debe ser CSV o Excel (.csv, .xlsx, .xls).", "bad");
      markError($("#provImportFile"));
      return;
    }
    try {
      await importarProveedoresCsv(file, delimiter);
      if ($("#provImportFile")) $("#provImportFile").value = "";
      if ($("#provImportFileName")) $("#provImportFileName").textContent = "Ningun archivo seleccionado";
      loadProveedoresManage();
      proveedoresLoaded = false;
      loadProveedores();
    } catch {
      showEntToast("Error procesando importacion de proveedores.", "bad");
    }
  };
}

if ($("#limImportBtn")) {
  $("#limImportBtn").onclick = async () => {
    const file = $("#limImportFile")?.files?.[0] || null;
    const delimiter = $("#limImportDelimiter")?.value || ",";
    if (!file) {
      showEntToast("Selecciona un archivo CSV para importar limites.", "bad");
      markError($("#limImportFile"));
      return;
    }
    if (!/\.(csv|xlsx|xls)$/i.test(file.name || "")) {
      showEntToast("El archivo de limites debe ser CSV o Excel (.csv, .xlsx, .xls).", "bad");
      markError($("#limImportFile"));
      return;
    }
    try {
      await importarLimitesCsv(file, delimiter);
      if ($("#limImportFile")) $("#limImportFile").value = "";
      if ($("#limImportFileName")) $("#limImportFileName").textContent = "Ningun archivo seleccionado";
      loadLimitesList();
    } catch {
      showEntToast("Error procesando importacion de limites.", "bad");
    }
  };
}

if ($("#prdRefresh")) {
  $("#prdRefresh").onclick = () => {
    if ($("#prdSearch")) $("#prdSearch").value = "";
    loadProductosManage();
  };
}

if ($("#prdSearchBtn")) {
  $("#prdSearchBtn").onclick = loadProductosManage;
}

if ($("#prdSearch")) {
  let prdSearchDebounceTimer = null;
  $("#prdSearch").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (prdSearchDebounceTimer) clearTimeout(prdSearchDebounceTimer);
      loadProductosManage();
    }
  });
  $("#prdSearch").addEventListener("input", () => {
    if (prdSearchDebounceTimer) clearTimeout(prdSearchDebounceTimer);
    prdSearchDebounceTimer = setTimeout(() => {
      loadProductosManage();
    }, 260);
  });
}

if ($("#prdEditSave")) {
  $("#prdEditSave").onclick = async () => {
    const id_producto = Number($("#prdEditId")?.value || 0);
    const nombre_producto = $("#prdEditNombre")?.value?.trim() || "";
    const sku = $("#prdEditSku")?.value?.trim() || null;
    const id_medida = Number($("#prdEditMedida")?.value || 0);
    const id_categoria = Number($("#prdEditCategoria")?.value || 0);
    const id_subcategoria = Number($("#prdEditSubcategoria")?.value || 0) || null;
    const activo = Number($("#prdEditActivo")?.value || 1);
    const id_bodegas_visibles = getSelectedProductWarehouseIds("#prdEditVisibleWarehouses");

    if (!id_producto) {
      showEntToast("Primero selecciona un producto de la lista.", "bad");
      return;
    }
    if (!nombre_producto) {
      showEntToast("El nombre del producto es obligatorio.", "bad");
      markError($("#prdEditNombre"));
      return;
    }
    if (!id_medida) {
      showEntToast("Selecciona la medida.", "bad");
      markError($("#prdEditMedida"));
      return;
    }
    if (!id_categoria) {
      showEntToast("Selecciona la categoria.", "bad");
      markError($("#prdEditCategoria"));
      return;
    }

    try {
      const r = await fetch(`/api/productos/${id_producto}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          nombre_producto,
          sku,
          id_medida,
          id_categoria,
          id_subcategoria,
          activo,
          id_bodegas_visibles,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        showEntToast(j.error || "Error actualizando producto.", "bad");
        return;
      }
      showEntToast("Producto actualizado.", "ok");
      $("#prdEditId").value = "";
      $("#prdEditNombre").value = "";
      $("#prdEditSku").value = "";
      $("#prdEditActivo").value = "1";
      $("#prdEditMedida").value = "";
      $("#prdEditCategoria").value = "";
      $("#prdEditSubcategoria").innerHTML = `<option value="">Seleccione subcategoria</option>`;
      renderProductWarehouseChecklist("#prdEditVisibleWarehouses", []);
      loadProductosManage();
    } catch {
      showEntToast("Error de red.", "bad");
    }
  };
}

function yesNoBadge(active) {
  return Number(active) ? `<span class="badgeTag ok">Activo</span>` : `<span class="badgeTag warn">Inactivo</span>`;
}

async function loadLimCatalogos() {
  if (limCatalogosLoaded) return;
  try {
    const [bodR, prdR] = await Promise.all([
      fetch("/api/bodegas", { headers: { Authorization: "Bearer " + token } }),
      fetch("/api/productos?all=1&limit=5000", { headers: { Authorization: "Bearer " + token } }),
    ]);
    const bodegas = await bodR.json().catch(() => []);
    const productos = await prdR.json().catch(() => []);
    if (!bodR.ok || !prdR.ok) return;

    const bodOpts =
      `<option value="">Seleccione bodega</option>` +
      bodegas.map((b) => `<option value="${b.id_bodega}">${b.nombre_bodega}</option>`).join("");
    const prdOpts =
      `<option value="">Seleccione producto</option>` +
      productos
        .map((p) => `<option value="${p.id_producto}">${p.nombre_producto}${p.sku ? ` (${p.sku})` : ""}</option>`)
        .join("");

    if ($("#limWarehouse")) $("#limWarehouse").innerHTML = bodOpts;
    if ($("#limProduct")) $("#limProduct").innerHTML = prdOpts;
    limCatalogosLoaded = true;
  } catch (e) { console.error('api_proveedores:', e); }
}

async function loadLimitesList() {
  const tb = $("#limList");
  if (!tb) return;
  tb.innerHTML = `<tr><td colspan="7">Cargando...</td></tr>`;
  try {
    const r = await fetch("/api/limites?all=1&limit=1000", {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) {
      tb.innerHTML = `<tr><td colspan="7">Error al cargar limites</td></tr>`;
      return;
    }
    if (!rows.length) {
      tb.innerHTML = `<tr><td colspan="7">Sin limites configurados</td></tr>`;
      return;
    }
    tb.innerHTML = rows
      .map(
        (x) => `
        <tr>
          <td>${x.nombre_bodega || x.id_bodega}</td>
          <td>${x.nombre_producto || x.id_producto}</td>
          <td>${x.sku || ""}</td>
          <td>${x.minimo ?? 0}</td>
          <td>${x.maximo ?? 0}</td>
          <td>${yesNoBadge(x.activo)}</td>
          <td style="white-space:nowrap;">
            <div class="gridActions">
              <button class="iconBtn edit" data-ledit="${x.id_bodega}|${x.id_producto}" title="Editar">E</button>
              <button class="iconBtn del" data-ldis="${x.id_bodega}|${x.id_producto}" title="Desactivar">X</button>
            </div>
          </td>
        </tr>
      `
      )
      .join("");

    tb.querySelectorAll("[data-ledit]").forEach((b) => {
      b.onclick = () => {
        const key = b.dataset.ledit || "";
        const it = rows.find((r0) => `${r0.id_bodega}|${r0.id_producto}` === key);
        if (!it) return;
        $("#limEditWarehouse").value = String(it.id_bodega);
        $("#limEditProduct").value = String(it.id_producto);
        $("#limEditWarehouseName").value = it.nombre_bodega || `#${it.id_bodega}`;
        $("#limEditProductName").value = it.nombre_producto || `#${it.id_producto}`;
        $("#limEditMin").value = String(it.minimo ?? 0);
        $("#limEditMax").value = String(it.maximo ?? 0);
        $("#limEditActive").value = Number(it.activo) ? "1" : "0";
        openAdminCollapseSection('view-limites', 'Editar limite');
      };
    });

    tb.querySelectorAll("[data-ldis]").forEach((b) => {
      b.onclick = async () => {
        const key = b.dataset.ldis || "";
        const [id_bodega, id_producto] = key.split("|").map((x) => Number(x || 0));
        if (!id_bodega || !id_producto) return;
        if (!(await uiConfirm("Desactivar este limite?", "Confirmar desactivacion"))) return;
        try {
          const rr = await fetch(`/api/limites/${id_bodega}/${id_producto}/deactivate`, {
            method: "POST",
            headers: { Authorization: "Bearer " + token },
          });
          const jj = await rr.json().catch(() => ({}));
          if (!rr.ok) {
            showEntToast(jj.error || "Error desactivando limite.", "bad");
            return;
          }
          showEntToast("Limite desactivado.", "ok");
          loadLimitesList();
        } catch {
          showEntToast("Error de red.", "bad");
        }
      };
    });
  } catch {
    tb.innerHTML = `<tr><td colspan="7">Error de red</td></tr>`;
  }
}

if ($("#limSave")) {
  $("#limSave").onclick = async () => {
    const id_bodega = Number($("#limWarehouse")?.value || 0);
    const id_producto = Number($("#limProduct")?.value || 0);
    const minimo = Number($("#limMin")?.value || 0);
    const maximo = Number($("#limMax")?.value || 0);
    const activo = Number($("#limActive")?.value || 1);
    if (!id_bodega) {
      showEntToast("Selecciona bodega.", "bad");
      markError($("#limWarehouse"));
      return;
    }
    if (!id_producto) {
      showEntToast("Selecciona producto.", "bad");
      markError($("#limProduct"));
      return;
    }
    if (minimo < 0 || maximo < 0) {
      showEntToast("Minimo y maximo no pueden ser negativos.", "bad");
      markError(minimo < 0 ? $("#limMin") : $("#limMax"));
      return;
    }
    if (maximo > 0 && minimo > maximo) {
      showEntToast("El minimo no puede ser mayor al maximo.", "bad");
      markError($("#limMin"));
      return;
    }
    try {
      const r = await fetch("/api/limites", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ id_bodega, id_producto, minimo, maximo, activo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        showEntToast(j.error || "Error guardando limite.", "bad");
        return;
      }
      showEntToast("Limite guardado.", "ok");
      $("#limWarehouse").value = "";
      $("#limProduct").value = "";
      $("#limMin").value = "";
      $("#limMax").value = "";
      $("#limActive").value = "1";
      loadLimitesList();
    } catch {
      showEntToast("Error de red.", "bad");
    }
  };
}

if ($("#limEditSave")) {
  $("#limEditSave").onclick = async () => {
    const id_bodega = Number($("#limEditWarehouse")?.value || 0);
    const id_producto = Number($("#limEditProduct")?.value || 0);
    const minimo = Number($("#limEditMin")?.value || 0);
    const maximo = Number($("#limEditMax")?.value || 0);
    const activo = Number($("#limEditActive")?.value || 1);
    if (!id_bodega || !id_producto) {
      showEntToast("Selecciona un limite de la lista.", "bad");
      return;
    }
    if (minimo < 0 || maximo < 0) {
      showEntToast("Minimo y maximo no pueden ser negativos.", "bad");
      markError(minimo < 0 ? $("#limEditMin") : $("#limEditMax"));
      return;
    }
    if (maximo > 0 && minimo > maximo) {
      showEntToast("El minimo no puede ser mayor al maximo.", "bad");
      markError($("#limEditMin"));
      return;
    }
    try {
      const r = await fetch(`/api/limites/${id_bodega}/${id_producto}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ minimo, maximo, activo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        showEntToast(j.error || "Error actualizando limite.", "bad");
        return;
      }
      showEntToast("Limite actualizado.", "ok");
      $("#limEditWarehouse").value = "";
      $("#limEditProduct").value = "";
      $("#limEditWarehouseName").value = "";
      $("#limEditProductName").value = "";
      $("#limEditMin").value = "";
      $("#limEditMax").value = "";
      $("#limEditActive").value = "1";
      loadLimitesList();
    } catch {
      showEntToast("Error de red.", "bad");
    }
  };
}

if ($("#limRefresh")) {
  $("#limRefresh").onclick = loadLimitesList;
}

async function loadRegCatalogos() {
  if (regCatalogosLoaded) return;
  const sel = $("#regSubcat");
  if (!sel) return;
  try {
    const r = await fetch("/api/subcategorias", {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) return;
    sel.innerHTML =
      `<option value="">Seleccione subcategoria</option>` +
      rows.map((s) => `<option value="${s.id_subcategoria}">${s.nombre_subcategoria}</option>`).join("");
    regCatalogosLoaded = true;
  } catch (e) { console.error('loadPedidoStock:', e); }
}

async function loadReglasList() {
  const tb = $("#regList");
  if (!tb) return;
  tb.innerHTML = `<tr><td colspan="7">Cargando...</td></tr>`;

  function reglaActualBadge(maxDiasVida, alertaAntes, activo) {
    if (!Number(activo)) return `<span class="statusLight neutral"><span class="dot"></span><span>Inactiva</span></span>`;
    const max = Math.max(0, Number(maxDiasVida || 0));
    const alert = Math.max(0, Number(alertaAntes || 0));
    if (!max) return `<span class="statusLight neutral"><span class="dot"></span><span>Sin vigencia</span></span>`;
    if (alert >= max) return `<span class="statusLight red"><span class="dot"></span><span>Alerta excedida</span></span>`;
    if (!alert) return `<span class="statusLight amber"><span class="dot"></span><span>Sin alerta previa</span></span>`;
    return `<span class="statusLight green"><span class="dot"></span><span>Normal (${alert}/${max} dias)</span></span>`;
  }
  try {
    const r = await fetch("/api/reglas-subcategorias?all=1", {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) {
      tb.innerHTML = `<tr><td colspan="7">Error al cargar reglas</td></tr>`;
      return;
    }
    if (!rows.length) {
      tb.innerHTML = `<tr><td colspan="7">Sin reglas configuradas</td></tr>`;
      return;
    }
    tb.innerHTML = rows
      .map(
        (x) => `
        <tr>
          <td>${x.nombre_categoria || "-"}</td>
          <td>${x.nombre_subcategoria || ""}</td>
          <td>${x.max_dias_vida ?? 0}</td>
          <td>${x.dias_alerta_antes ?? 0}</td>
          <td>${yesNoBadge(x.activo)}</td>
          <td>${reglaActualBadge(x.max_dias_vida, x.dias_alerta_antes, x.activo)}</td>
          <td style="white-space:nowrap;">
            <div class="gridActions">
              <button class="iconBtn edit" data-redit="${x.id_subcategoria}" title="Editar">E</button>
              <button class="iconBtn del" data-rdis="${x.id_subcategoria}" title="Desactivar">X</button>
            </div>
          </td>
        </tr>
      `
      )
      .join("");

    tb.querySelectorAll("[data-redit]").forEach((b) => {
      b.onclick = () => {
        const id = Number(b.dataset.redit || 0);
        const it = rows.find((r0) => Number(r0.id_subcategoria) === id);
        if (!it) return;
        $("#regEditSubcatId").value = String(it.id_subcategoria);
        $("#regEditSubcatName").value = it.nombre_subcategoria || `#${it.id_subcategoria}`;
        $("#regEditMaxDays").value = String(it.max_dias_vida ?? 0);
        $("#regEditAlertDays").value = String(it.dias_alerta_antes ?? 0);
        $("#regEditActive").value = Number(it.activo) ? "1" : "0";
        openAdminCollapseSection('view-reglas-subcategorias', 'Editar regla');
      };
    });

    tb.querySelectorAll("[data-rdis]").forEach((b) => {
      b.onclick = async () => {
        const id = Number(b.dataset.rdis || 0);
        if (!id) return;
        if (!(await uiConfirm("Desactivar esta regla?", "Confirmar desactivacion"))) return;
        try {
          const rr = await fetch(`/api/reglas-subcategorias/${id}/deactivate`, {
            method: "POST",
            headers: { Authorization: "Bearer " + token },
          });
          const jj = await rr.json().catch(() => ({}));
          if (!rr.ok) {
            showEntToast(jj.error || "Error desactivando regla.", "bad");
            return;
          }
          showEntToast("Regla desactivada.", "ok");
          loadReglasList();
        } catch {
          showEntToast("Error de red.", "bad");
        }
      };
    });
  } catch {
    tb.innerHTML = `<tr><td colspan="6">Error de red</td></tr>`;
  }
}

if ($("#regSave")) {
  $("#regSave").onclick = async () => {
    const id_subcategoria = Number($("#regSubcat")?.value || 0);
    const max_dias_vida = Math.max(0, Number($("#regMaxDays")?.value || 0));
    const dias_alerta_antes = Math.max(0, Number($("#regAlertDays")?.value || 0));
    const activo = Number($("#regActive")?.value || 1);
    if (!id_subcategoria) {
      showEntToast("Selecciona subcategoria.", "bad");
      markError($("#regSubcat"));
      return;
    }
    try {
      const r = await fetch("/api/reglas-subcategorias", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ id_subcategoria, max_dias_vida, dias_alerta_antes, activo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        showEntToast(j.error || "Error guardando regla.", "bad");
        return;
      }
      showEntToast("Regla guardada.", "ok");
      $("#regSubcat").value = "";
      $("#regMaxDays").value = "";
      $("#regAlertDays").value = "";
      $("#regActive").value = "1";
      loadReglasList();
    } catch {
      showEntToast("Error de red.", "bad");
    }
  };
}

if ($("#regEditSave")) {
  $("#regEditSave").onclick = async () => {
    const id_subcategoria = Number($("#regEditSubcatId")?.value || 0);
    const max_dias_vida = Math.max(0, Number($("#regEditMaxDays")?.value || 0));
    const dias_alerta_antes = Math.max(0, Number($("#regEditAlertDays")?.value || 0));
    const activo = Number($("#regEditActive")?.value || 1);
    if (!id_subcategoria) {
      showEntToast("Selecciona una regla de la lista.", "bad");
      return;
    }
    try {
      const r = await fetch(`/api/reglas-subcategorias/${id_subcategoria}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ max_dias_vida, dias_alerta_antes, activo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        showEntToast(j.error || "Error actualizando regla.", "bad");
        return;
      }
      showEntToast("Regla actualizada.", "ok");
      $("#regEditSubcatId").value = "";
      $("#regEditSubcatName").value = "";
      $("#regEditMaxDays").value = "";
      $("#regEditAlertDays").value = "";
      $("#regEditActive").value = "1";
      loadReglasList();
    } catch {
      showEntToast("Error de red.", "bad");
    }
  };
}

if ($("#regRefresh")) {
  $("#regRefresh").onclick = loadReglasList;
}

async function loadRolesUsuario() {
  if (usrRolesLoaded) return;
  const sel = $("#usrRole");
  const editSel = $("#usrEditRole");
  if (!sel && !editSel) return;
  try {
    const r = await fetch("/api/roles", {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) return;
    const opts =
      `<option value="">Seleccione rol</option>` +
      rows.map((x) => `<option value="${x.id_role}">${x.role_name}</option>`).join("");
    if (sel) sel.innerHTML = opts;
    if (editSel) editSel.innerHTML = opts;
    usrRolesLoaded = true;
  } catch (e) { console.error('api_usuarios:', e); }
}

async function loadBodegasUsuarioForm() {
  if (usrBodegasLoaded) return;
  const sel = $("#usrWarehouse");
  const editSel = $("#usrEditWarehouse");
  if (!sel && !editSel) return;
  try {
    const r = await fetch("/api/bodegas", {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) return;
    usrBodegasCatalog = Array.isArray(rows) ? rows : [];
    const opts =
      `<option value="">Seleccione bodega</option>` +
      rows.map((x) => `<option value="${x.id_bodega}">${x.nombre_bodega}</option>`).join("");
    if (sel) sel.innerHTML = opts;
    if (editSel) editSel.innerHTML = opts;
    usrBodegasLoaded = true;
  } catch (e) { console.error('loadUsuariosBodegas:', e); }
}

async function loadUsuariosResetForm() {
  if (usrResetUsersLoaded) return;
  const sel = $("#usrResetUser");
  if (!sel) return;
  try {
    const r = await fetch("/api/usuarios", {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) return;
    sel.innerHTML =
      `<option value="">Seleccione usuario</option>` +
      rows
        .map((u) => `<option value="${u.id_user}">${u.full_name}${u.username ? ` (${u.username})` : ""}</option>`)
        .join("");
    usrResetUsersLoaded = true;
  } catch (e) { console.error('loadMyPermissions:', e); }
}

async function ensurePermCatalogLoaded() {
  if (Array.isArray(permCatalog) && permCatalog.length) return;
  try {
    const r = await fetch("/api/permisos/catalogo", {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) return;
    permCatalog = Array.isArray(rows) ? rows : [];
  } catch (e) { console.error('ensurePermCatalogLoaded:', e); }
}

function renderUserPermList(permisosMap) {
  const box = $("#usrPermList");
  if (!box) return;
  if (!Array.isArray(permCatalog) || !permCatalog.length) {
    box.innerHTML = `<div class="note">No hay catalogo de permisos.</div>`;
    return;
  }
  const byGroup = new Map();
  permCatalog.forEach((p) => {
    const g = p.group || "General";
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(p);
  });
  let html = "";
  byGroup.forEach((items, group) => {
    html += `<div class="permItem" style="grid-column:1/-1"><strong>${group}</strong></div>`;
    items.forEach((p) => {
      const checked = Number(permisosMap?.[p.key] ?? 1) === 1 ? "checked" : "";
      html += `
        <label class="permItem">
          <span class="permLabel">${p.label}</span>
          <input class="permSwitch" type="checkbox" data-perm-key="${p.key}" ${checked} />
        </label>
      `;
    });
  });
  box.innerHTML = html;
  const canManage = hasPerm("action.manage_permissions");
  box.querySelectorAll(".permSwitch").forEach((sw) => {
    sw.disabled = !canManage;
  });
}

async function loadUsuariosPermForm() {
  const sel = $("#usrPermUser");
  if (!sel) return;
  await ensurePermCatalogLoaded();
  if (!usrPermUsersLoaded) {
    try {
      const r = await fetch("/api/usuarios?all=1", {
        headers: { Authorization: "Bearer " + token },
      });
      const rows = await r.json().catch(() => []);
      if (r.ok) {
        sel.innerHTML =
          `<option value="">Seleccione usuario</option>` +
          rows
            .map((u) => `<option value="${u.id_user}">${u.full_name}${u.username ? ` (${u.username})` : ""}</option>`)
            .join("");
        usrPermUsersLoaded = true;
      }
    } catch (e) { console.error('loadUsuariosList:', e); }
  }
  if ($("#usrPermList") && !$("#usrPermList").innerHTML.trim()) {
    renderUserPermList(permissionDefaultsClient());
  }
  if (!sel.dataset.bound) {
    sel.onchange = () => loadSelectedUsuarioPerms();
    sel.dataset.bound = "1";
  }
  if ($("#usrPermReload") && !$("#usrPermReload").dataset.bound) {
    $("#usrPermReload").onclick = () => loadSelectedUsuarioPerms(true);
    $("#usrPermReload").dataset.bound = "1";
  }
  if ($("#usrPermSave") && !$("#usrPermSave").dataset.bound) {
    $("#usrPermSave").onclick = () => saveSelectedUsuarioPerms();
    $("#usrPermSave").dataset.bound = "1";
  }
  applyActionPermissions();
}

function permissionDefaultsClient() {
  const map = {};
  (permCatalog || []).forEach((p) => {
    map[p.key] = 1;
  });
  return map;
}

function collectPermsFromUI() {
  const map = permissionDefaultsClient();
  document.querySelectorAll("#usrPermList .permSwitch[data-perm-key]").forEach((x) => {
    const k = x.dataset.permKey;
    if (!k) return;
    map[k] = x.checked ? 1 : 0;
  });
  return map;
}

async function loadSelectedUsuarioPerms(force = false) {
  const sel = $("#usrPermUser");
  if (!sel) return;
  const id = Number(sel.value || 0);
  currentPermUserId = id;
  if (!id) {
    renderUserPermList(permissionDefaultsClient());
    return;
  }
  const box = $("#usrPermList");
  if (box && force) box.innerHTML = `<div class="note">Cargando permisos...</div>`;
  try {
    const r = await fetch(`/api/usuarios/${id}/permisos`, {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      showEntToast(j.error || "No se pudieron cargar los permisos.", "bad");
      return;
    }
    if (Array.isArray(j.catalogo) && j.catalogo.length) permCatalog = j.catalogo;
    renderUserPermList(j.permisos || permissionDefaultsClient());
  } catch {
    showEntToast("Error de red cargando permisos.", "bad");
  }
}

async function saveSelectedUsuarioPerms() {
  if (!hasPerm("action.manage_permissions")) {
    showEntToast("No tienes permiso para administrar permisos.", "bad");
    return;
  }
  const id = Number($("#usrPermUser")?.value || currentPermUserId || 0);
  if (!id) {
    showEntToast("Selecciona un usuario.", "bad");
    markError($("#usrPermUser"));
    return;
  }
  const permisos = collectPermsFromUI();
  try {
    const r = await fetch(`/api/usuarios/${id}/permisos`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ permisos }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      showEntToast(j.error || "No se pudieron guardar los permisos.", "bad");
      return;
    }
    showEntToast("Permisos guardados correctamente.", "ok");
    if (me && Number(me.id_user) === id) {
      await loadMyPermissions();
      applyMenuPermissions();
      applyActionPermissions();
    }
  } catch {
    showEntToast("Error de red guardando permisos.", "bad");
  }
}

function getManageUserMeta(id) {
  return usrManageUsersMap.get(Number(id || 0)) || null;
}

function userSupportsWarehouseAccess(userMeta) {
  const roleName = String(userMeta?.role_name || "").trim().toUpperCase();
  return roleName.includes("REPORTE") && !roleName.includes("ADMIN");
}

function renderWarehouseAccessList(selectedIds = [], opts = {}) {
  const box = $("#usrWhAccessList");
  if (!box) return;
  const selected = new Set((Array.isArray(selectedIds) ? selectedIds : []).map((x) => Number(x || 0)));
  const canManage = hasPerm("action.manage_permissions");
  const userMeta = getManageUserMeta(opts.userId || 0);
  if (!opts.userId) {
    box.innerHTML = `<div class="note">Selecciona un usuario para configurar bodegas.</div>`;
    return;
  }
  if (!userSupportsWarehouseAccess(userMeta)) {
    box.innerHTML = `<div class="note">Este filtro solo aplica a usuarios con rol de reportes no administradores.</div>`;
    return;
  }
  if (!Array.isArray(usrBodegasCatalog) || !usrBodegasCatalog.length) {
    box.innerHTML = `<div class="note">No hay bodegas disponibles.</div>`;
    return;
  }
  box.innerHTML = usrBodegasCatalog
    .filter((b) => Number(b.activo ?? 1) === 1)
    .map((b) => `
      <label class="permItem">
        <span class="permLabel">${b.nombre_bodega}</span>
        <input class="warehouseCheck" type="checkbox" data-wh-id="${b.id_bodega}" ${selected.has(Number(b.id_bodega)) ? "checked" : ""} ${canManage ? "" : "disabled"} />
      </label>
    `)
    .join("");
}

function collectWarehouseAccessFromUI() {
  return Array.from(document.querySelectorAll("#usrWhAccessList .warehouseCheck[data-wh-id]:checked"))
    .map((el) => Number(el.dataset.whId || 0))
    .filter((id) => id > 0);
}

async function loadUsuariosWarehouseAccessForm() {
  const sel = $("#usrWhAccessUser");
  if (!sel) return;
  await loadBodegasUsuarioForm();
  if (!usrWhAccessUsersLoaded) {
    try {
      const r = await fetch("/api/usuarios?all=1", {
        headers: { Authorization: "Bearer " + token },
      });
      const rows = await r.json().catch(() => []);
      if (r.ok) {
        (Array.isArray(rows) ? rows : []).forEach((u) => {
          usrManageUsersMap.set(Number(u.id_user || 0), u);
        });
        sel.innerHTML =
          `<option value="">Seleccione usuario</option>` +
          rows
            .map((u) => `<option value="${u.id_user}">${u.full_name}${u.username ? ` (${u.username})` : ""}</option>`)
            .join("");
        usrWhAccessUsersLoaded = true;
      }
    } catch (e) { console.error('loadUsersRegisters:', e); }
  }
  if (!sel.dataset.bound) {
    sel.onchange = () => loadSelectedUsuarioWarehouseAccess();
    sel.dataset.bound = "1";
  }
  if ($("#usrWhAccessReload") && !$("#usrWhAccessReload").dataset.bound) {
    $("#usrWhAccessReload").onclick = () => loadSelectedUsuarioWarehouseAccess(true);
    $("#usrWhAccessReload").dataset.bound = "1";
  }
  if ($("#usrWhAccessSave") && !$("#usrWhAccessSave").dataset.bound) {
    $("#usrWhAccessSave").onclick = () => saveSelectedUsuarioWarehouseAccess();
    $("#usrWhAccessSave").dataset.bound = "1";
  }
  if (!$("#usrWhAccessList")?.innerHTML.trim()) {
    renderWarehouseAccessList([], { userId: 0 });
  }
  applyActionPermissions();
}

async function loadSelectedUsuarioWarehouseAccess(force = false) {
  const sel = $("#usrWhAccessUser");
  if (!sel) return;
  const id = Number(sel.value || 0);
  currentWhAccessUserId = id;
  if (!id) {
    renderWarehouseAccessList([], { userId: 0 });
    return;
  }
  const userMeta = getManageUserMeta(id);
  if (!userSupportsWarehouseAccess(userMeta)) {
    renderWarehouseAccessList([], { userId: id });
    return;
  }
  const box = $("#usrWhAccessList");
  if (box && force) box.innerHTML = `<div class="note">Cargando bodegas...</div>`;
  try {
    const r = await fetch(`/api/usuarios/${id}/bodegas-acceso`, {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      showEntToast(j.error || "No se pudieron cargar las bodegas.", "bad");
      return;
    }
    renderWarehouseAccessList(j.ids || [], { userId: id });
  } catch {
    showEntToast("Error de red cargando bodegas permitidas.", "bad");
  }
}

async function saveSelectedUsuarioWarehouseAccess() {
  if (!hasPerm("action.manage_permissions")) {
    showEntToast("No tienes permiso para administrar accesos de bodegas.", "bad");
    return;
  }
  const id = Number($("#usrWhAccessUser")?.value || currentWhAccessUserId || 0);
  if (!id) {
    showEntToast("Selecciona un usuario.", "bad");
    markError($("#usrWhAccessUser"));
    return;
  }
  const userMeta = getManageUserMeta(id);
  if (!userSupportsWarehouseAccess(userMeta)) {
    showEntToast("Ese usuario no admite filtro de bodegas por rol.", "bad");
    return;
  }
  const id_bodegas = collectWarehouseAccessFromUI();
  try {
    const r = await fetch(`/api/usuarios/${id}/bodegas-acceso`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ id_bodegas }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      showEntToast(j.error || "No se pudieron guardar las bodegas.", "bad");
      return;
    }
    showEntToast("Bodegas visibles guardadas correctamente.", "ok");
    await loadSelectedUsuarioWarehouseAccess();
  } catch {
    showEntToast("Error de red guardando bodegas permitidas.", "bad");
  }
}

function isValidAvatarData(value) {
  return typeof value === "string" && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value.trim());
}

function setAvatarPreview(imgId, fallbackId, data) {
  const img = $(imgId);
  const fallback = $(fallbackId);
  if (!img || !fallback) return;
  if (isValidAvatarData(data)) {
    img.src = data;
    img.classList.remove("hidden");
    fallback.classList.add("hidden");
  } else {
    img.removeAttribute("src");
    img.classList.add("hidden");
    fallback.classList.remove("hidden");
  }
}

function setLogoPreview(imgId, fallbackId, data) {
  const img = $(imgId);
  const fallback = $(fallbackId);
  if (!img || !fallback) return;
  if (isValidAvatarData(data)) {
    img.src = data;
    img.classList.remove("hidden");
    fallback.classList.add("hidden");
  } else {
    img.removeAttribute("src");
    img.classList.add("hidden");
    fallback.classList.remove("hidden");
  }
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(typeof fr.result === "string" ? fr.result : "");
    fr.onerror = () => reject(new Error("No se pudo leer el archivo"));
    fr.readAsDataURL(file);
  });
}

function bindAvatarInput(fileId, dataId, imgId, fallbackId, clearId) {
  const fileInput = $(fileId);
  const hiddenInput = $(dataId);
  const clearBtn = $(clearId);
  if (!fileInput || !hiddenInput) return;

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
    if (!file) return;
    if (!String(file.type || "").startsWith("image/")) {
      showEntToast("El archivo debe ser una imagen.", "bad");
      fileInput.value = "";
      return;
    }
    if (Number(file.size || 0) > 1024 * 1024) {
      showEntToast("El avatar no puede superar 1MB.", "bad");
      fileInput.value = "";
      return;
    }
    try {
      const data = await readFileAsDataURL(file);
      hiddenInput.value = data;
      setAvatarPreview(imgId, fallbackId, data);
    } catch {
      showEntToast("No se pudo leer el avatar.", "bad");
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      hiddenInput.value = "";
      fileInput.value = "";
      setAvatarPreview(imgId, fallbackId, "");
    });
  }
}

function bindLogoInput(fileId, dataId, imgId, fallbackId, clearId) {
  const fileInput = $(fileId);
  const hiddenInput = $(dataId);
  const clearBtn = $(clearId);
  if (!fileInput || !hiddenInput) return;

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
    if (!file) return;
    if (!String(file.type || "").startsWith("image/")) {
      showEntToast("El archivo debe ser una imagen.", "bad");
      fileInput.value = "";
      return;
    }
    if (Number(file.size || 0) > 1024 * 1024) {
      showEntToast("El logo no puede superar 1MB.", "bad");
      fileInput.value = "";
      return;
    }
    try {
      const data = await readFileAsDataURL(file);
      hiddenInput.value = data;
      setLogoPreview(imgId, fallbackId, data);
    } catch {
      showEntToast("No se pudo leer el logo.", "bad");
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      hiddenInput.value = "";
      fileInput.value = "";
      setLogoPreview(imgId, fallbackId, "");
    });
  }
}

bindAvatarInput("#usrAvatarFile", "#usrAvatarData", "#usrAvatarPreviewImg", "#usrAvatarPreviewFallback", "#usrAvatarClear");
bindAvatarInput(
  "#usrEditAvatarFile",
  "#usrEditAvatarData",
  "#usrEditAvatarPreviewImg",
  "#usrEditAvatarPreviewFallback",
  "#usrEditAvatarClear"
);
setAvatarPreview("#usrAvatarPreviewImg", "#usrAvatarPreviewFallback", "");
setAvatarPreview("#usrEditAvatarPreviewImg", "#usrEditAvatarPreviewFallback", "");
bindLogoInput("#bodLogoAppFile", "#bodLogoAppData", "#bodLogoAppPreviewImg", "#bodLogoAppPreviewFallback", "#bodLogoAppClear");
bindLogoInput("#bodLogoPrintFile", "#bodLogoPrintData", "#bodLogoPrintPreviewImg", "#bodLogoPrintPreviewFallback", "#bodLogoPrintClear");
setLogoPreview("#bodLogoAppPreviewImg", "#bodLogoAppPreviewFallback", "");
setLogoPreview("#bodLogoPrintPreviewImg", "#bodLogoPrintPreviewFallback", "");

function usuarioEstadoTag(active) {
  return Number(active) ? `<span class="badgeTag ok">Activo</span>` : `<span class="badgeTag warn">Inactivo</span>`;
}

async function loadUsuariosManage() {
  const tb = $("#usrManageList");
  if (!tb) return;
  tb.innerHTML = `<tr><td colspan="9">Cargando...</td></tr>`;
  try {
    const r = await fetch("/api/usuarios?all=1", {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) {
      tb.innerHTML = `<tr><td colspan="9">Error al cargar usuarios</td></tr>`;
      return;
    }
    if (!rows.length) {
      tb.innerHTML = `<tr><td colspan="9">Sin usuarios</td></tr>`;
      return;
    }
    usrManageUsersMap.clear();
    rows.forEach((u) => {
      usrManageUsersMap.set(Number(u.id_user || 0), u);
    });
    tb.innerHTML = rows
      .map(
        (u) => `
        <tr>
          <td>${u.id_user}</td>
          <td class="avatarCell">${isValidAvatarData(u.avatar_url || "") ? `<img class="avatarThumb" src="${u.avatar_url}" alt="Avatar" />` : `<span class="avatarThumbEmpty">-</span>`}</td>
          <td>${u.username || ""}</td>
          <td>${u.full_name || ""}</td>
          <td>${u.role_name || "-"}</td>
          <td>${u.warehouse_name || "-"}</td>
          <td>${Number(u.can_supervisor) ? "Si" : "No"}</td>
          <td>${usuarioEstadoTag(u.active)}</td>
          <td style="white-space:nowrap;">
            <div class="gridActions">
              <button class="iconBtn edit" data-uedit="${u.id_user}" title="Editar">E</button>
              <button class="iconBtn del" data-udeactivate="${u.id_user}" title="Desactivar">X</button>
            </div>
          </td>
        </tr>
      `
      )
      .join("");

    tb.querySelectorAll("[data-uedit]").forEach((b) => {
      b.onclick = () => {
        const id = Number(b.dataset.uedit || 0);
        const u = rows.find((x) => Number(x.id_user) === id);
        if (!u) return;
        $("#usrEditId").value = String(u.id_user);
        $("#usrEditUsername").value = u.username || "";
        $("#usrEditFullName").value = u.full_name || "";
        $("#usrEditActive").value = Number(u.active) ? "1" : "0";
        $("#usrEditRole").value = u.id_role ? String(u.id_role) : "";
        $("#usrEditWarehouse").value = u.id_warehouse ? String(u.id_warehouse) : "";
        if ($("#usrEditNoAutoLogout")) $("#usrEditNoAutoLogout").value = Number(u.no_auto_logout) ? "1" : "0";
        if ($("#usrEditCanSupervisor")) $("#usrEditCanSupervisor").value = Number(u.can_supervisor) ? "1" : "0";
        $("#usrEditAvatarData").value = isValidAvatarData(u.avatar_url || "") ? String(u.avatar_url) : "";
        if ($("#usrEditAvatarFile")) $("#usrEditAvatarFile").value = "";
        setAvatarPreview("#usrEditAvatarPreviewImg", "#usrEditAvatarPreviewFallback", $("#usrEditAvatarData").value);
        if ($("#usrWhAccessUser")) {
          $("#usrWhAccessUser").value = String(u.id_user);
          loadSelectedUsuarioWarehouseAccess();
        }
        const editSection = Array.from(document.querySelectorAll("#view-usuarios .userSection")).find(
          (sec) => sec.querySelector(".cardTitle")?.textContent?.trim() === "Editar usuario"
        );
        syncUserAccordionState(editSection, true);
      };
    });

    tb.querySelectorAll("[data-udeactivate]").forEach((b) => {
      b.onclick = async () => {
        const id = Number(b.dataset.udeactivate || 0);
        if (!id) return;
        if (!(await uiConfirm(`Desactivar usuario #${id}?`, "Confirmar desactivacion"))) return;
        try {
          const rr = await fetch(`/api/usuarios/${id}/deactivate`, {
            method: "POST",
            headers: { Authorization: "Bearer " + token },
          });
          const jj = await rr.json().catch(() => ({}));
          if (!rr.ok) {
            showEntToast(jj.error || "Error desactivando usuario.", "bad");
            return;
          }
          showEntToast("Usuario desactivado.", "ok");
          usrResetUsersLoaded = false;
          usrPermUsersLoaded = false;
          usrWhAccessUsersLoaded = false;
          loadUsuariosResetForm();
          loadUsuariosPermForm();
          loadUsuariosWarehouseAccessForm();
          loadUsuariosManage();
        } catch {
          showEntToast("Error de red.", "bad");
        }
      };
    });
  } catch {
    tb.innerHTML = `<tr><td colspan="9">Error de red</td></tr>`;
  }
}

function buildUsernameFromFullName(fullName) {
  const parts = String(fullName || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) {
    return parts[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  const firstInitial = parts[0].charAt(0);
  const lastName = parts[parts.length - 1];
  return `${firstInitial}${lastName}`.toLowerCase().replace(/[^a-z0-9]/g, "");
}

if ($("#usrFullName") && $("#usrUsername")) {
  const usrFullNameEl = $("#usrFullName");
  const usrUsernameEl = $("#usrUsername");

  const syncUsernameFromFullName = () => {
    if (!usrFullNameEl || !usrUsernameEl) return;
    const generated = buildUsernameFromFullName(usrFullNameEl.value || "");
    const current = (usrUsernameEl.value || "").trim();
    const isAuto = usrUsernameEl.dataset.autoGeneratedUsername === "1";
    if (!current || isAuto) {
      usrUsernameEl.value = generated;
      usrUsernameEl.dataset.autoGeneratedUsername = generated ? "1" : "0";
    }
  };

  usrFullNameEl.addEventListener("input", syncUsernameFromFullName);
  usrUsernameEl.addEventListener("input", () => {
    if (!usrFullNameEl || !usrUsernameEl) return;
    const generated = buildUsernameFromFullName(usrFullNameEl.value || "");
    const current = (usrUsernameEl.value || "").trim();
    usrUsernameEl.dataset.autoGeneratedUsername = current && current === generated ? "1" : "0";
  });
}

if ($("#usrSave")) {
  $("#usrSave").onclick = async () => {
    const username = $("#usrUsername")?.value?.trim() || "";
    const full_name = $("#usrFullName")?.value?.trim() || "";
    const password = $("#usrPassword")?.value || "";
    const order_pin = ($("#usrOrderPin")?.value || "").trim();
    const can_supervisor = Number($("#usrCanSupervisor")?.value || 0) ? 1 : 0;
    const id_role = Number($("#usrRole")?.value || 0);
    const id_warehouse = Number($("#usrWarehouse")?.value || 0) || null;
    const active = Number($("#usrActive")?.value || 1);
    const no_auto_logout = Number($("#usrNoAutoLogout")?.value || 0);
    const avatar_data = ($("#usrAvatarData")?.value || "").trim() || null;

    if (!username) {
      showEntToast("El usuario es obligatorio.", "bad");
      markError($("#usrUsername"));
      return;
    }
    if (!full_name) {
      showEntToast("El nombre completo es obligatorio.", "bad");
      markError($("#usrFullName"));
      return;
    }
    if (!password || password.length < 6) {
      showEntToast("La contrasena debe tener al menos 6 caracteres.", "bad");
      markError($("#usrPassword"));
      return;
    }
    if (order_pin && !/^\d{6,12}$/.test(order_pin)) {
      showEntToast("El PIN de pedidos debe tener entre 6 y 12 digitos.", "bad");
      markError($("#usrOrderPin"));
      return;
    }
    if (!id_role) {
      showEntToast("Selecciona un rol.", "bad");
      markError($("#usrRole"));
      return;
    }

    try {
      const r = await fetch("/api/usuarios", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          username,
          full_name,
          password,
          order_pin: order_pin || null,
          can_supervisor,
          id_role,
          id_warehouse,
          active,
          no_auto_logout,
          avatar_data,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        showEntToast(j.error || "Error guardando usuario.", "bad");
        return;
      }
      showEntToast(`Usuario creado #${j.id_user}`, "ok");
      $("#usrUsername").value = "";
      $("#usrFullName").value = "";
      $("#usrPassword").value = "";
      if ($("#usrOrderPin")) $("#usrOrderPin").value = "";
      if ($("#usrCanSupervisor")) $("#usrCanSupervisor").value = "0";
      $("#usrRole").value = "";
      $("#usrWarehouse").value = "";
      $("#usrActive").value = "1";
      if ($("#usrNoAutoLogout")) $("#usrNoAutoLogout").value = "0";
      $("#usrAvatarData").value = "";
      if ($("#usrAvatarFile")) $("#usrAvatarFile").value = "";
      setAvatarPreview("#usrAvatarPreviewImg", "#usrAvatarPreviewFallback", "");
      usuariosLoaded = false;
      usrResetUsersLoaded = false;
      usrPermUsersLoaded = false;
      usrWhAccessUsersLoaded = false;
      loadUsuariosResetForm();
      loadUsuariosPermForm();
      loadUsuariosWarehouseAccessForm();
      loadUsuariosManage();
    } catch {
      showEntToast("Error de red.", "bad");
    }
  };
}

if ($("#usrResetSave")) {
  const clearResetPasswordFields = () => {
    if ($("#usrResetPassword")) $("#usrResetPassword").value = "";
    if ($("#usrResetPassword2")) $("#usrResetPassword2").value = "";
  };
  if ($("#usrResetUser")) {
    $("#usrResetUser").addEventListener("change", clearResetPasswordFields);
  }
  $("#usrResetSave").onclick = async () => {
    const id_user = Number($("#usrResetUser")?.value || 0);
    const password = $("#usrResetPassword")?.value || "";
    const password2 = $("#usrResetPassword2")?.value || "";

    if (!id_user) {
      showEntToast("Selecciona un usuario.", "bad");
      markError($("#usrResetUser"));
      return;
    }
    if (!password || password.length < 6) {
      showEntToast("La contrasena debe tener al menos 6 caracteres.", "bad");
      markError($("#usrResetPassword"));
      return;
    }
    if (password !== password2) {
      showEntToast("Las contrasenas no coinciden.", "bad");
      markError($("#usrResetPassword2"));
      return;
    }

    try {
      const r = await fetch(`/api/usuarios/${id_user}/reset-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        showEntToast(j.error || "Error restableciendo contrasena.", "bad");
        return;
      }
      showEntToast("Contrasena restablecida correctamente.", "ok");
      clearResetPasswordFields();
    } catch {
      showEntToast("Error de red.", "bad");
    }
  };
}

if ($("#usrResetOrderPinSave")) {
  $("#usrResetOrderPinSave").onclick = async () => {
    const id_user = Number($("#usrResetUser")?.value || 0);
    const pin = ($("#usrResetOrderPin")?.value || "").trim();
    const pin2 = ($("#usrResetOrderPin2")?.value || "").trim();

    if (!id_user) {
      showEntToast("Selecciona un usuario.", "bad");
      markError($("#usrResetUser"));
      return;
    }
    if (!/^\d{6,12}$/.test(pin)) {
      showEntToast("El PIN de pedidos debe tener entre 6 y 12 digitos.", "bad");
      markError($("#usrResetOrderPin"));
      return;
    }
    if (pin !== pin2) {
      showEntToast("Los PIN de pedidos no coinciden.", "bad");
      markError($("#usrResetOrderPin2"));
      return;
    }

    try {
      const r = await fetch(`/api/usuarios/${id_user}/reset-order-pin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ pin }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        showEntToast(j.error || "Error restableciendo PIN de pedidos.", "bad");
        return;
      }
      showEntToast("PIN de pedidos restablecido correctamente.", "ok");
      $("#usrResetOrderPin").value = "";
      $("#usrResetOrderPin2").value = "";
    } catch {
      showEntToast("Error de red.", "bad");
    }
  };
}

if ($("#usrRefresh")) {
  $("#usrRefresh").onclick = async () => {
    usrResetUsersLoaded = false;
    await loadUsuariosResetForm();
    await loadUsuariosManage();
  };
}

if ($("#usrEditSave")) {
  $("#usrEditSave").onclick = async () => {
    const id_user = Number($("#usrEditId")?.value || 0);
    const username = $("#usrEditUsername")?.value?.trim() || "";
    const full_name = $("#usrEditFullName")?.value?.trim() || "";
    const id_role = Number($("#usrEditRole")?.value || 0);
    const id_warehouse = Number($("#usrEditWarehouse")?.value || 0) || null;
    const active = Number($("#usrEditActive")?.value || 0);
    const no_auto_logout = Number($("#usrEditNoAutoLogout")?.value || 0);
    const can_supervisor = Number($("#usrEditCanSupervisor")?.value || 0) ? 1 : 0;
    const avatar_data = ($("#usrEditAvatarData")?.value || "").trim() || null;

    if (!id_user) {
      showEntToast("Primero selecciona un usuario de la lista.", "bad");
      return;
    }
    if (!username) {
      showEntToast("El usuario es obligatorio.", "bad");
      markError($("#usrEditUsername"));
      return;
    }
    if (!full_name) {
      showEntToast("El nombre completo es obligatorio.", "bad");
      markError($("#usrEditFullName"));
      return;
    }
    if (!id_role) {
      showEntToast("Selecciona un rol.", "bad");
      markError($("#usrEditRole"));
      return;
    }

    try {
      const r = await fetch(`/api/usuarios/${id_user}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          username,
          full_name,
          id_role,
          id_warehouse,
          active,
          no_auto_logout,
          can_supervisor,
          avatar_data,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        showEntToast(j.error || "Error actualizando usuario.", "bad");
        return;
      }
      showEntToast("Usuario actualizado.", "ok");
      $("#usrEditId").value = "";
      $("#usrEditUsername").value = "";
      $("#usrEditFullName").value = "";
      $("#usrEditRole").value = "";
      $("#usrEditWarehouse").value = "";
      $("#usrEditActive").value = "1";
      if ($("#usrEditNoAutoLogout")) $("#usrEditNoAutoLogout").value = "0";
      if ($("#usrEditCanSupervisor")) $("#usrEditCanSupervisor").value = "0";
      $("#usrEditAvatarData").value = "";
      if ($("#usrEditAvatarFile")) $("#usrEditAvatarFile").value = "";
      setAvatarPreview("#usrEditAvatarPreviewImg", "#usrEditAvatarPreviewFallback", "");
      if (me && Number(me.id_user) === id_user) {
        me.full_name = full_name;
        me.id_warehouse = id_warehouse;
        me.avatar_url = avatar_data || "";
        localStorage.setItem("me", JSON.stringify(me));
        menuWarehouseLabel = me.id_warehouse ? "Cargando bodega..." : "Sin bodega";
        menuAvatarData = me.avatar_url;
        renderMenuUserLabel();
        renderMenuAvatar();
        await applyWarehouseBranding(me.id_warehouse);
        loadBodegaUsuario();
        loadBodegaUsuarioSalida();
      }
      usrResetUsersLoaded = false;
      usrPermUsersLoaded = false;
      usrWhAccessUsersLoaded = false;
      loadUsuariosResetForm();
      loadUsuariosPermForm();
      loadUsuariosWarehouseAccessForm();
      loadUsuariosManage();
    } catch {
      showEntToast("Error de red.", "bad");
    }
  };
}

renderEntradas();

function updatePedidoCount() {
  const countStr = pedList.length + " productos";
  if (document.querySelector("#pedCount")) document.querySelector("#pedCount").textContent = countStr;
  if (typeof updateFabBadge === "function") updateFabBadge();
  
}


function renderPedidos() {
  const box = $("#pedList");
  if (!box) return;
  if (!pedList.length) {
    box.innerHTML = `<div class="note">Sin productos en el carro.</div>`;
    if ($("#pedSave")) $("#pedSave").disabled = true;
    if ($("#pedPrintPos")) $("#pedPrintPos").disabled = true;
    updatePedidoCount();
    return;
  }
  if ($("#pedSave")) $("#pedSave").disabled = false;
  if ($("#pedPrintPos")) $("#pedPrintPos").disabled = false;
  box.innerHTML = pedList
    .map(
      (x, i) => `
      <div class="cartItem">
        <div class="cartLeft">
          <div class="cartName">${x.producto}</div>
          <div class="cartMeta">ID ${x.id_product} ${x.sku ? `- ${x.sku}` : ""}</div>
          <input class="lineNote" data-note="${i}" value="${x.line_note || ""}" placeholder="Descripcion por producto" />
        </div>
        <div class="cartRight">
          <div class="qtyRow">
            <div class="qtyWrap">
              <button class="iconBtnSm" data-minus="${i}" title="Restar">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" /></svg>
              </button>
              <input class="in qtyInput" data-qty="${i}" type="number" min="0" step="1" value="${x.qty_requested}" />
              <button class="iconBtnSm" data-plus="${i}" title="Sumar">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12" /></svg>
              </button>
            </div>
            <div class="stockPill">Stock: ${x.stock ?? "?"}</div>
            <button class="iconBtnSm ghost" data-del="${i}" title="Eliminar">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7l-10 10" /></svg>
            </button>
          </div>
        </div>
      </div>
    `
    )
    .join("");

  /* Stagger entrance animation */
  box.querySelectorAll(".cartItem").forEach((el, i) => {
    el.style.animationDelay = i * 0.04 + "s";
  });

  box.querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = () => {
      const idx = Number(b.dataset.del);
      const item = b.closest(".cartItem");
      if (item) {
        item.classList.add("removing");
        item.style.animationDelay = "0s";
        setTimeout(() => {
          pedList.splice(idx, 1);
          renderPedidos();
        }, 260);
      } else {
        pedList.splice(idx, 1);
        renderPedidos();
      }
    };
  });

  box.querySelectorAll("[data-qty]").forEach((inp) => {
    inp.oninput = () => {
      const idx = Number(inp.dataset.qty);
      const it = pedList[idx];
      if (!it) return;
      it.qty_requested = Number(inp.value || 0);
    };
  });

  box.querySelectorAll("[data-plus]").forEach((b) => {
    b.onclick = () => {
      const idx = Number(b.dataset.plus);
      const it = pedList[idx];
      if (!it) return;
      it.qty_requested = Number(it.qty_requested || 0) + 1;
      renderPedidos();
    };
  });

  box.querySelectorAll("[data-minus]").forEach((b) => {
    b.onclick = () => {
      const idx = Number(b.dataset.minus);
      const it = pedList[idx];
      if (!it) return;
      const next = Number(it.qty_requested || 0) - 1;
      it.qty_requested = next < 0 ? 0 : next;
      renderPedidos();
    };
  });

  box.querySelectorAll("[data-note]").forEach((inp) => {
    inp.oninput = () => {
      const idx = Number(inp.dataset.note);
      const it = pedList[idx];
      if (!it) return;
      it.line_note = inp.value;
    };
  });

  updatePedidoCount();
}

async function openPedidoPosPreviewFromCart() {
  if (!pedList.length) {
    showEntToast("No hay productos en el carro para imprimir.", "bad");
    return;
  }
  const w = window.open("", "_blank");
  if (!w) {
    showEntToast("El navegador bloqueo la ventana de impresion.", "bad");
    return;
  }

  w.document.open();
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"/><title>Cargando impresion...</title></head><body style="font-family:Arial,sans-serif;padding:16px;">Preparando vista de impresion...</body></html>`);
  w.document.close();

  try {
    const withTimeout = (promise, ms, fallback) =>
      Promise.race([
        Promise.resolve(promise).catch(() => fallback),
        new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
      ]);

    const requesterName = $("#pedUser")?.selectedOptions?.[0]?.textContent?.trim() || "N/D";
    const reqWh = $("#pedRequesterWarehouseName")?.value?.trim() || "N/D";
    const fromWh = $("#pedFromWarehouse")?.selectedOptions?.[0]?.textContent?.trim() || "N/D";
    const requesterWhId = Number($("#pedRequesterWarehouseId")?.value || 0) || Number(me?.id_warehouse || 0) || null;
    const fromWhId = Number($("#pedFromWarehouse")?.value || 0) || null;
    const notes = $("#pedNotes")?.value?.trim() || "";
    const now = fmtDateTime(new Date());
    const totalSolicitado = pedList.reduce((acc, x) => acc + Number(x.qty_requested || 0), 0);
    const logoSrc =
      (await withTimeout(fetchPreferredWarehousePrintLogoData(requesterWhId, fromWhId), 1800, "")) ||
      `${API_ORIGIN}/imagenes/JDL_negro.png`;
    const footerContact = await withTimeout(
      fetchPreferredWarehouseContact(requesterWhId, fromWhId),
      1800,
      { phone: "", address: "" }
    );
    const footerLines = [
      footerContact.phone ? `Tel: ${escapeHtml(footerContact.phone)}` : "",
      footerContact.address ? `Direccion: ${escapeHtml(footerContact.address)}` : "",
    ].filter(Boolean);

    const linesHtml = pedList
      .map(
        (x) => `
      <div class="line">
        <div class="lineMain">
          <div class="productName">${escapeHtml(x.producto || "")}</div>
          <div class="qtyWrap">
            <div class="qtyLabel">Cant Sol</div>
            <div class="n qtyValue">${Number(x.qty_requested || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}</div>
          </div>
        </div>
        ${x.line_note ? `<div class="lineNote">${escapeHtml(x.line_note)}</div>` : ``}
      </div>
    `
      )
      .join("");

    const html = `<!doctype html><html lang="es"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Pedido POS 80mm</title>
<style>
  :root{ --paper-width:80mm; }
  *{ box-sizing:border-box; }
  body{ margin:0; background:#eef2f7; font-family:Arial,"Helvetica Neue",Helvetica,"Liberation Sans","Noto Sans",sans-serif; color:#0f172a; }
  .toolbar{ position:sticky; top:0; z-index:5; background:#0f172a; color:#fff; padding:8px 10px; display:flex; justify-content:center; gap:8px; }
  .toolbar button{ border:1px solid #334155; background:#1e293b; color:#fff; border-radius:8px; padding:6px 10px; font-size:14px; cursor:pointer; }
  .paper{ width:var(--paper-width); margin:14px auto; background:#fff; border:1px solid #dbe2ea; border-radius:8px; padding:8px 8px 12px; box-shadow:0 10px 28px rgba(2,6,23,.16); font-size:13px; line-height:1.35; font-variant-numeric:tabular-nums; }
  .center{ text-align:center; }
  .logoWrap{ width:52mm; height:18mm; margin:0 auto 3px; display:flex; align-items:center; justify-content:center; }
  .logo{ max-width:52mm; max-height:18mm; width:auto; height:auto; display:block; object-fit:contain; }
  .sep{ border-top:1px dashed #334155; margin:6px 0; }
  .row{ display:flex; justify-content:space-between; gap:6px; }
  .muted{ color:#475569; }  .tableHead{ padding:0 2px 5px; border-bottom:2px solid #475569; margin-bottom:5px; }
  .line{ margin:7px 0; padding:7px 6px; border:2px solid #64748b; border-left:4px solid #0f172a; border-radius:4px; font-size:14px; }
  .lineMain{ display:flex; justify-content:space-between; align-items:flex-start; gap:8px; }
  .productName{ flex:1; font-weight:700; line-height:1.25; word-break:break-word; }
  .qtyWrap{ min-width:20mm; padding-left:6px; padding-right:4.2mm; border-left:2px dashed #64748b; text-align:right; margin-right:0; }
  .qtyLabel{ color:#0f172a; font-size:12px; line-height:1.1; font-weight:800; letter-spacing:.1px; }
  .qtyValue{ font-size:17px; font-weight:900; line-height:1.05; color:#000; }
  .lineNote{ margin-top:5px; padding-top:4px; border-top:2px dashed #94a3b8; color:#334155; font-size:12px; white-space:pre-wrap; }
  .n{ text-align:right; white-space:nowrap; padding-right:0; }
  .tableHead .n{ color:#0f172a; font-weight:900; padding-right:4.2mm; }
  .sign{ margin-top:36px; text-align:center; font-size:12px; color:#334155; }
  .signLine{ margin:0 auto 6px; width:85%; border-top:1px solid #64748b; }
  .foot{ margin-top:8px; text-align:center; color:#334155; font-size:12px; }
  @media print{
    @page{ size:80mm auto; margin:2mm; }
    body{ background:#fff; }
    .toolbar{ display:none !important; }
    .paper{ width:auto; margin:0; border:0; border-radius:0; box-shadow:none; padding:0 2.8mm 0 0.8mm; font-size:12px; }
  }
</style>
</head><body>
  <div class="toolbar">
    <button type="button" onclick="window.print()">Imprimir</button>
    <button type="button" onclick="window.close()">Cerrar</button>
  </div>
  <div class="paper">
    <div class="center">
      <div class="logoWrap">
        <img class="logo" src="${logoSrc}" alt="Logo bodega" />
      </div>
    </div>
    <div class="sep"></div>
    <div><b>Solicita:</b> ${escapeHtml(requesterName)}</div>
    <div><b>Bodega solicita:</b> ${escapeHtml(reqWh)}</div>
    <div><b>Bodega surtidor:</b> ${escapeHtml(fromWh)}</div>
    <div><b>Fecha:</b> ${escapeHtml(now)}</div>
    ${notes ? `<div><b>Notas:</b> ${escapeHtml(notes)}</div>` : ``}
    <div class="sep"></div>
    <div class="row muted tableHead"><div>Producto</div><div class="n">Cant Sol</div></div>
    ${linesHtml}
    <div class="sep"></div>
    <div class="row"><div><b>Total solicitado</b></div><div class="n"><b>${Number(totalSolicitado || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}</b></div></div>
    <div class="sign">
      <div class="signLine"></div>
      <div>Firma Encargado de Despacho</div>
    </div>
    <div class="foot">
      ${footerLines.join("<br/>")}
    </div>
  </div>
</body></html>`;

    w.document.open();
    w.document.write(html);
    w.document.close();
  } catch {
    w.document.open();
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"/><title>Error de impresion</title></head><body style="font-family:Arial,sans-serif;padding:16px;"><h3>No se pudo generar la impresion</h3><p>Intenta nuevamente. Si el problema continua, recarga la pagina.</p></body></html>`);
    w.document.close();
    showEntToast("No se pudo generar la vista de impresion POS.", "bad");
  }
}

function clearPedidoLine() {
  if ($("#pedProducto")) $("#pedProducto").value = "";
  if ($("#pedProducto")) $("#pedProducto").dataset.id = "";
  if ($("#pedCantidad")) $("#pedCantidad").value = "";
  if ($("#pedLineaNota")) $("#pedLineaNota").value = "";
  if ($("#pedStock")) $("#pedStock").value = "";
}

if ($("#pedAdd")) {
  $("#pedAdd").onclick = () => {
    const producto = $("#pedProducto").value.trim();
    const id_product = $("#pedProducto").dataset.id ? Number($("#pedProducto").dataset.id) : null;
    const qty_requested = Number($("#pedCantidad").value || 0);
    const line_note = $("#pedLineaNota").value.trim();
    const stock = $("#pedStock").value ? Number($("#pedStock").value) : null;

    if (!id_product || !producto) {
      showEntToast("Selecciona el producto desde el buscador.", "bad");
      markError($("#pedProducto"));
      return;
    }
    if (!qty_requested || qty_requested <= 0) {
      showEntToast("La cantidad es obligatoria.", "bad");
      markError($("#pedCantidad"));
      return;
    }

    const existing = pedList.find((x) => x.id_product === id_product);
    if (existing) {
      existing.qty_requested += qty_requested;
      if (line_note) existing.line_note = line_note;
      existing.stock = stock ?? existing.stock;
    } else {
      pedList.push({
        id_product,
        producto,
        qty_requested,
        line_note: line_note || null,
        stock,
      });
    }

    clearPedidoLine();
    renderPedidos();
  };
}

if ($("#pedClear")) {
  $("#pedClear").onclick = async () => {
    if (!pedList.length) return;
    if (!(await uiConfirm("Vaciar el carro de pedido?", "Confirmar vaciado"))) return;
    const items = document.querySelectorAll("#pedList .cartItem");
    if (items.length) {
      items.forEach((el) => el.classList.add("removing"));
      await new Promise((r) => setTimeout(r, 260));
    }
    pedList.splice(0, pedList.length);
    renderPedidos();
    showEntToast("Carro vaciado correctamente.", "ok");
    resetPedidoTab();
  };
}

if ($("#pedPrintPos")) {
  $("#pedPrintPos").onclick = () => {
    openPedidoPosPreviewFromCart();
  };
}

// =============================================
// FLOATING CART FAB + DRAWER (mobile pedidos)
// =============================================
const pedCartFab     = $("#pedCartFab");
const pedCartOverlay = $("#pedCartOverlay");
const pedCartDrawer  = $("#pedCartDrawer");
const pedCartDrawerClose = $("#pedCartDrawerClose");

function openPedCartDrawer() {
  if (!pedCartDrawer) return;
  syncDrawerList();
  pedCartDrawer.classList.add("open");
  if (pedCartOverlay) pedCartOverlay.classList.add("open");
  document.body.classList.add("cart-drawer-open");
}

function closePedCartDrawer() {
  if (!pedCartDrawer) return;
  pedCartDrawer.classList.remove("open");
  if (pedCartOverlay) pedCartOverlay.classList.remove("open");
  document.body.classList.remove("cart-drawer-open");
}

function syncDrawerList() {
  // Mirror the main pedList into the drawer list
  const drawerList = $("#pedListDrawer");
  const mainList   = $("#pedList");
  if (drawerList && mainList) drawerList.innerHTML = mainList.innerHTML;
  // Sync notes
  const drawerNotes = $("#pedNotesDrawer");
  const mainNotes   = $("#pedNotes");
  if (drawerNotes && mainNotes) drawerNotes.value = mainNotes.value;
  // Sync drawer badge
  const drawerBadge = $("#pedCartDrawerBadge");
  if (drawerBadge) drawerBadge.textContent = pedList.length;
}

// Update FAB count badge
function updateFabBadge() {
  const fab = $("#pedCartFab");
  const badge = $("#pedCartFabBadge");
  if (!fab || !badge) return;
  badge.textContent = pedList.length;
  fab.classList.toggle("has-items", pedList.length > 0);
  // Bounce animation on add
  if (pedList.length > 0) {
    fab.classList.remove("bounce");
    void fab.offsetWidth; // reflow
    fab.classList.add("bounce");
    fab.addEventListener("animationend", () => fab.classList.remove("bounce"), { once: true });
  }
}

if (pedCartFab)          pedCartFab.onclick = openPedCartDrawer;
if (pedCartOverlay)      pedCartOverlay.onclick = closePedCartDrawer;
if (pedCartDrawerClose)  pedCartDrawerClose.onclick = closePedCartDrawer;

if ($("#pedRefreshDrawer")) $("#pedRefreshDrawer").onclick = () => { loadBodegasPedido(); loadUsuariosPedido(); };

// =============================================
// STEP FLOW PEDIDOS (mobile) - navigation
// =============================================
if ($("#pedStepToProducts")) {
  $("#pedStepToProducts").onclick = () => {
    const view = document.getElementById("view-pedidos");
    if (view) view.classList.add("step-products");
  };
}
if ($("#pedStepBackBtn")) {
  $("#pedStepBackBtn").onclick = () => {
    const view = document.getElementById("view-pedidos");
    if (view) view.classList.remove("step-products");
  };
}


// Escape key closes drawer
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePedCartDrawer();
});

// Drawer action buttons mirror main buttons
if ($("#pedClearDrawer")) {
  $("#pedClearDrawer").onclick = async () => {
    const mainClear = $("#pedClear");
    if (mainClear) { mainClear.click(); closePedCartDrawer(); }
  };
}
if ($("#pedPrintPosDrawer")) {
  $("#pedPrintPosDrawer").onclick = () => { openPedidoPosPreviewFromCart(); };
}
if ($("#pedSaveDrawer")) {
  $("#pedSaveDrawer").onclick = async () => {
    const mainSave = $("#pedSave");
    if (mainSave) { mainSave.click(); closePedCartDrawer(); }
  };
}
// Sync notes from drawer back to main on input
if ($("#pedNotesDrawer")) {
  $("#pedNotesDrawer").addEventListener("input", () => {
    const main = $("#pedNotes");
    if (main) main.value = $("#pedNotesDrawer").value;
  });
}

function resetPedidoTab() {
  closePedCartDrawer();
  const pv = document.getElementById(iew-pedidos);
  if (pv) pv.classList.remove(step-products);
}


if ($("#pedSave")) {
  const detectPedidoGuardadoReciente = async ({
    requester_user_id,
    requester_warehouse_id,
    requested_from_warehouse_id,
    notes,
  }) => {
    try {
      const rr = await fetch("/api/orders?scope=mine", {
        headers: { Authorization: "Bearer " + token },
      });
      const rows = await rr.json().catch(() => []);
      if (!rr.ok || !Array.isArray(rows) || !rows.length) return null;
      const noteNorm = String(notes || "").trim().toLowerCase();
      const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
      return (
        rows.find((x) => {
          if (Number(x?.id_usuario_solicita || 0) !== Number(requester_user_id || 0)) return false;
          if (Number(x?.id_bodega_solicita || 0) !== Number(requester_warehouse_id || 0)) return false;
          if (Number(x?.id_bodega_surtidor || 0) !== Number(requested_from_warehouse_id || 0)) return false;
          const rowNotes = String(x?.observaciones || "").trim().toLowerCase();
          if (noteNorm && rowNotes !== noteNorm) return false;
          const created = new Date(x?.creado_en || "").getTime();
          if (!Number.isFinite(created)) return false;
          return created >= tenMinutesAgo;
        }) || null
      );
    } catch {
      return null;
    }
  };

  $("#pedSave").onclick = async () => {
    setFechaHoraPedidoActual();
    if (pedSaveInFlight) return;
    if (!pedList.length) return;
    const requester_warehouse_id = Number($("#pedRequesterWarehouseId")?.value || 0);
    const requested_from_warehouse_id = Number($("#pedFromWarehouse")?.value || 0);
    const requester_user_id = Number($("#pedUser")?.value || 0);
    const requester_pin = String($("#pedUserPin")?.value || "").trim();
    if (!requester_warehouse_id) {
      showEntToast("Selecciona la bodega solicitante.", "bad");
      markError($("#pedRequesterWarehouseName"));
      return;
    }
    if (!requester_user_id) {
      showEntToast("Selecciona el usuario solicitante.", "bad");
      markError($("#pedUser"));
      return;
    }
    if (!requested_from_warehouse_id) {
      showEntToast("Selecciona la bodega que despacha.", "bad");
      markError($("#pedFromWarehouse"));
      return;
    }
    if (!requester_pin) {
      showEntToast("Ingresa tu codigo de usuario para autorizar el pedido.", "bad");
      markError($("#pedUserPin"));
      return;
    }
    if (!/^\d{6,12}$/.test(requester_pin)) {
      showEntToast("El PIN de pedido debe tener entre 6 y 12 digitos.", "bad");
      markError($("#pedUserPin"));
      return;
    }

    const payload = {
      requester_user_id,
      requester_warehouse_id,
      requester_pin,
      requested_from_warehouse_id,
      notes: $("#pedNotes")?.value?.trim() || null,
      lines: pedList.map((x) => ({
        id_product: x.id_product,
        qty_requested: x.qty_requested,
        line_note: x.line_note || null,
      })),
    };

    pedSaveInFlight = true;
    const pedSaveBtn = $("#pedSave");
    if (pedSaveBtn) pedSaveBtn.disabled = true;
    /* Mobile saving indicator */
    const pedSide = document.querySelector('#view-pedidos .orderSide');
    if (pedSide) pedSide.classList.add('is-saving');
    const peekText = document.querySelector('#view-pedidos .cartPeekText');
    if (peekText) {
      peekText.dataset.originalText = peekText.textContent;
      peekText.textContent = 'Guardando pedido...';
    }
    showSavingProgressToast("pedido");
    try {
      const r = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 413) {
          showEntToast("Carga demasiado grande. Intenta enviar el pedido en bloques mas pequenos.", "bad");
          return;
        }
        showEntToast(j.error || "Error guardando pedido.", "bad");
        return;
      }
      pedList.splice(0, pedList.length);
      renderPedidos();
      clearSectionTextboxes("#view-pedidos");
      setFechaHoraPedidoActual();
      if ($("#pedProducto")) $("#pedProducto").dataset.id = "";
      if ($("#pedUserPin")) $("#pedUserPin").value = "";
      showEntToast(`Pedido guardado #${j.id_order}`, "ok");
      resetPedidoTab();
    } catch {
      const hit = await detectPedidoGuardadoReciente({
        requester_user_id,
        requester_warehouse_id,
        requested_from_warehouse_id,
        notes: $("#pedNotes")?.value?.trim() || null,
      });
      if (hit?.id_pedido) {
        pedList.splice(0, pedList.length);
        renderPedidos();
        clearSectionTextboxes("#view-pedidos");
        setFechaHoraPedidoActual();
        if ($("#pedProducto")) $("#pedProducto").dataset.id = "";
        if ($("#pedUserPin")) $("#pedUserPin").value = "";
        showEntToast(`Pedido guardado #${hit.id_pedido}. La respuesta tardo y se perdio la conexion.`, "ok");
        resetPedidoTab();
        return;
      }
      showEntToast("Error de red. Si la carga era grande, verifica en Reporte de Pedidos antes de reintentar.", "bad");
    } finally {
    /* Mobile saving indicator */
    if (pedSide) pedSide.classList.remove('is-saving');
    const peekText = document.querySelector('#view-pedidos .cartPeekText');
    if (peekText && peekText.dataset.originalText) {
      peekText.textContent = peekText.dataset.originalText;
      delete peekText.dataset.originalText;
    }
      pedSaveInFlight = false;
      renderPedidos();
    }
  };
}

renderPedidos();

function fmtDateTime(d) {
  if (!d) return "";
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return String(d);
    const fecha = fmtDateOnly(dt);
    const hh = String(dt.getHours()).padStart(2, "0");
    const mm = String(dt.getMinutes()).padStart(2, "0");
    const ss = String(dt.getSeconds()).padStart(2, "0");
    return `${fecha} ${hh}:${mm}:${ss}`;
  } catch {
    return "";
  }
}

function statusBadge(estado) {
  const st = String(estado || "").toUpperCase();
  if (st === "COMPLETADO") return `<span class="badgeTag ok">Despachado</span>`;
  if (st === "COMPLETADO_JUSTIFICADO") return `<span class="badgeTag justified">Despachado con justificacion</span>`;
  if (st === "PARCIAL") return `<span class="badgeTag partial">Despacho parcial</span>`;
  return `<span class="badgeTag warn">Por atender</span>`;
}

function orderStatusRank(estado) {
  const st = String(estado || "").toUpperCase();
  if (st === "PENDIENTE") return 0;
  if (st === "PARCIAL") return 1;
  if (st === "COMPLETADO_JUSTIFICADO") return 2;
  if (st === "COMPLETADO") return 3;
  return 4;
}

function getDispatchJustificacion() {
  return String($("#pedDispatchJustificacion")?.value || "").trim();
}

async function loadPedidosDespachar() {
  const tb = $("#pedOrdersList");
  if (!tb) return;
  tb.innerHTML = `<tr><td colspan="7">Cargando...</td></tr>`;
  try {
    const r = await fetch("/api/orders?scope=dispatch", {
      headers: { Authorization: "Bearer " + token },
    });
    const rows = await r.json().catch(() => []);
    if (!r.ok) {
      tb.innerHTML = `<tr><td colspan="7">Error al cargar</td></tr>`;
      return;
    }
    const list = rows.filter((x) => (x.estado || x.status) !== "CANCELADO");
    const sortedList = list.slice().sort((a, b) => {
      const ra = orderStatusRank(a.estado || a.status);
      const rb = orderStatusRank(b.estado || b.status);
      if (ra !== rb) return ra - rb;
      const ta = new Date(a.creado_en || a.created_at || 0).getTime();
      const tbTs = new Date(b.creado_en || b.created_at || 0).getTime();
      return tbTs - ta;
    });
    if (!list.length) {
      tb.innerHTML = `<tr><td colspan="7">Sin pedidos por despachar.</td></tr>`;
      return;
    }

    /* Client-side search filter */
    const searchQuery = String(document.querySelector('#pedDispatchSearch')?.value || '').trim().toLowerCase();
    const filteredList = searchQuery
      ? sortedList.filter((o) => {
          const id = String(o.id_pedido ?? o.id_order ?? '');
          const name = String(o.requester_name || '').toLowerCase();
          const wh = String(o.requester_warehouse || '').toLowerCase();
          const status = String(o.estado || o.status || '').toLowerCase();
          return id.includes(searchQuery) || name.includes(searchQuery) || wh.includes(searchQuery) || status.includes(searchQuery);
        })
      : sortedList;

    if (!filteredList.length) {
      tb.innerHTML = `<tr><td colspan="7">Sin resultados para "${searchQuery}".</td></tr>`;
      return;
    }
    tb.innerHTML = filteredList
      .map(
        (o) => {
          const estado = String(o.estado || o.status || "").toUpperCase();
          const isDone = estado === "COMPLETADO" || estado === "COMPLETADO_JUSTIFICADO" || estado === "CANCELADO";
          const just = String(o.justificacion_despacho || "").trim();
          return `
        <tr>
          <td>#${o.id_pedido ?? o.id_order}</td>
          <td>${o.requester_name || "N/D"}</td>
          <td>${o.requester_warehouse || "N/D"}</td>
          <td>${statusBadge(estado)}${just ? `<div class="cartMeta"><strong>${escapeHtml(just)}</strong></div>` : ""}</td>
          <td>${o.tipo_salida || "SALIDA"}</td>
          <td>${fmtDateTime(o.creado_en || o.created_at)}</td>
          <td>
            <div class="dispatchActions">
              <button class="dispatchBtn dispatchBtn-ok ${isDone ? "disabled" : ""}" data-fulfill="${o.id_pedido ?? o.id_order}" title="Despachar">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l4 4 10-10" /></svg>
                <span>Despachar</span>
              </button>
              <button class="dispatchBtn dispatchBtn-neutral" data-lots="${o.id_pedido ?? o.id_order}" title="Ver lotes">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
                <span>Lotes</span>
              </button>
              <button class="dispatchBtn dispatchBtn-pdf" data-pdf="${o.id_pedido ?? o.id_order}" title="Generar PDF">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h9l3 3v17H6z"/><path d="M9 13h6M9 17h6M9 9h3"/></svg>
                <span>PDF</span>
              </button>
              <button class="dispatchBtn dispatchBtn-pos" data-pos="${o.id_pedido ?? o.id_order}" title="Ticket POS 80mm">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12v14l-2-1-2 1-2-1-2 1-2-1-2 1z"/><path d="M9 9h6M9 12h6"/></svg>
                <span>POS 80mm</span>
              </button>
              <button class="dispatchBtn dispatchBtn-danger ${estado === "PENDIENTE" ? "disabled" : ""}" data-revert="${o.id_pedido ?? o.id_order}" title="Revertir">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v6h6" /></svg>
                <span>Revertir</span>
              </button>
            </div>
          </td>
        </tr>
      `;
        }
      )
      .join("");

    tb.querySelectorAll("[data-fulfill]").forEach((b) => {
      b.onclick = async () => {
        const id = Number(b.dataset.fulfill);
        if (!id) return;
        await openDispatchModal(id);
      };
    });

    tb.querySelectorAll("[data-lots]").forEach((b) => {
      b.onclick = async () => {
        const id = Number(b.dataset.lots);
        if (!id) return;
        await openLotsModal(id);
      };
    });

    tb.querySelectorAll("[data-pdf]").forEach((b) => {
      b.onclick = () => {
        const id = Number(b.dataset.pdf);
        if (!id) return;
        const tk = encodeURIComponent(token || "");
        window.open(`${API_ORIGIN}/api/print/order/${id}?token=${tk}`, "_blank");
      };
    });

    tb.querySelectorAll("[data-pos]").forEach((b) => {
      b.onclick = () => {
        const id = Number(b.dataset.pos);
        if (!id) return;
        const tk = encodeURIComponent(token || "");
        window.open(`${API_ORIGIN}/api/print/order/${id}/pos80?token=${tk}`, "_blank");
      };
    });

    tb.querySelectorAll("[data-revert]").forEach((b) => {
      b.onclick = async () => {
        const id = Number(b.dataset.revert);
        if (!id || pedDispatchRevertInFlight) return;
        pedDispatchRevertInFlight = true;
        b.classList.add("is-loading");
        if (!(await uiConfirm(`Revertir el despacho del pedido #${id}? (Solo el mismo dia)\n\n⚠ ADVERTENCIA: Si la bodega destino ya recibio o uso el producto, el stock quedara INCONSISTENTE. Solo revierte si estas seguro.`, "Confirmar reversion"))) {
          pedDispatchRevertInFlight = false;
          b.classList.remove("is-loading");
          return;
        }
        try {
          let rr = await fetch(`/api/orders/${id}/revert`, {
            method: "POST",
            headers: { Authorization: "Bearer " + token },
          });
          let jj = await rr.json().catch(() => ({}));
          if (!rr.ok && (jj.code === "SENSITIVE_APPROVAL_REQUIRED" || jj.code === "SUPERVISOR_PIN_REQUIRED")) {
            const ap = await promptSensitiveApproval(`reversion pedido #${id}`);
            if (!ap) {
              showEntToast("Reversion cancelada: falta validacion de supervisor.", "bad");
              return;
            }
            rr = await fetch(`/api/orders/${id}/revert`, {
              method: "POST",
              headers: {
                Authorization: "Bearer " + token,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(ap),
            });
            jj = await rr.json().catch(() => ({}));
          }
          if (!rr.ok) {
            showEntToast(jj.error || "Error al revertir.", "bad");
            return;
          }
          showSupervisorAuthBadge(jj.sensitive_approval);
          showEntToast(`Pedido #${id} revertido`, "ok");
          loadPedidosDespachar();
        } catch {
          showEntToast("Error de red.", "bad");
        } finally {
          pedDispatchRevertInFlight = false;
          if (b) b.classList.remove("is-loading");
        }
      };
    });
  } catch {
    tb.innerHTML = `<tr><td colspan="6">Error de red</td></tr>`;
  }
}

if ($("#pedRefresh")) {
  $("#pedRefresh").onclick = loadPedidosDespachar;
}

if ($("#pedDispatchRefresh")) {
  $("#pedDispatchRefresh").onclick = loadPedidosDespachar;
}

if ($("#pedDispatchSearchBtn")) {
  $("#pedDispatchSearchBtn").onclick = () => {
    loadPedidosDespachar();
  };
}

if ($("#pedDispatchSearch")) {
  $("#pedDispatchSearch").onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      loadPedidosDespachar();
    }
  };
}

let dispatchOrderId = null;
const dispatchTodayMap = new Map();

async function openDispatchModal(id, opts = {}) {
  const parsedOrderId = Number(id);
  if (!Number.isFinite(parsedOrderId) || parsedOrderId <= 0) {
    showEntToast("Pedido invalido para despacho.", "bad");
    return;
  }
  dispatchOrderId = parsedOrderId;
  const orderId = parsedOrderId;
  const modal = $("#pedDispatchModal");
  const info = $("#pedDispatchInfo");
  const body = $("#pedDispatchLines");
  const justInp = $("#pedDispatchJustificacion");
  if (!modal || !body) return;
  modal.classList.remove("hidden");
  body.innerHTML = `<tr><td colspan="8">Cargando...</td></tr>`;
  try {
    const r = await fetch(`/api/orders/${orderId}/details`, {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      body.innerHTML = `<tr><td colspan="8">Error al cargar</td></tr>`;
      return;
    }
    info.textContent = `Pedido #${orderId} - Bodega surtidor: ${j.from_warehouse || "N/D"}`;
    if (justInp) justInp.value = String(j.justificacion_despacho || "");
    const lines = j.lines || [];
    if (!lines.length) {
      body.innerHTML = `<tr><td colspan="8">Sin lineas pendientes.</td></tr>`;
      return;
    }
    body.innerHTML = lines
      .map((ln) => {
        const stockNum = Number(ln.stock ?? 0);
        const pendienteNum = Number(ln.pendiente ?? 0);
        const safeStock = Number.isFinite(stockNum) ? Math.max(stockNum, 0) : 0;
        const maxQty = safeStock;
        const defaultQty = Math.max(0, Math.min(Math.max(pendienteNum, 0), maxQty));
        const estadoLinea = String(ln.estado_linea || (pendienteNum <= 0 ? "DESPACHADO" : "PENDIENTE")).toUpperCase();
        const isCanceled = estadoLinea === "ANULADO";
        const done = pendienteNum <= 0 || estadoLinea === "DESPACHADO";
        const canCancel = !isCanceled && pendienteNum > 0;
        const justLinea = String(ln.justificacion_linea || "").trim();
        const rowClass = isCanceled ? "dispatchLineCanceled" : "";
        const key = `${orderId}:${ln.id_pedido_detalle}`;
        const dispHoyRaw =
          ln.cantidad_despachada_hoy ?? ln.despachado_hoy ?? ln.cantidad_surtida ?? dispatchTodayMap.get(key) ?? 0;
        const dispHoyNum = Number(dispHoyRaw);
        const dispHoy = Number.isFinite(dispHoyNum) ? Math.max(0, dispHoyNum) : 0;
        return `
        <tr class="${rowClass}">
          <td>${ln.nombre_producto}</td>
          <td>${ln.cantidad_solicitada}</td>
          <td>${ln.pendiente}</td>
          <td>${ln.stock ?? 0}</td>
          <td>
            <input class="in qtyInput" data-fulfill-line="${ln.id_pedido_detalle}" data-pending="${pendienteNum}" type="number" min="0" step="1" max="${maxQty}" value="${defaultQty}" ${isCanceled ? "disabled" : ""} />
          </td>
          <td><span class="cartMeta" data-despachado="${ln.id_pedido_detalle}"><strong>${dispHoy}</strong></span></td>
          <td>
            <div class="dispatchLineActions">
              <button class="dispatchActionIcon dispatchActionIcon-ok" data-fulfill-one="${ln.id_pedido_detalle}" title="Despachar linea" aria-label="Despachar linea" ${isCanceled ? "disabled" : ""}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l4 4 10-10" /></svg>
              </button>
              <button class="dispatchActionIcon dispatchActionIcon-cancel" data-cancel-one="${ln.id_pedido_detalle}" title="No despachado / anular linea" aria-label="No despachado / anular linea" ${canCancel ? "" : "disabled"}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20"/><path d="M7 7l10 10"/></svg>
              </button>
              <button class="dispatchActionIcon dispatchActionIcon-danger" data-revert-one="${ln.id_pedido_detalle}" data-is-canceled="${isCanceled ? "1" : "0"}" title="${isCanceled ? "Habilitar linea" : "Revertir linea"}" aria-label="${isCanceled ? "Habilitar linea" : "Revertir linea"}">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7l-10 10" /></svg>
              </button>
            </div>
          </td>
          <td>${
            isCanceled
              ? `<span class="badgeTag canceled">No despachado</span>${justLinea ? `<div class="cartMeta"><strong>${escapeHtml(justLinea)}</strong></div>` : ""}`
              : done
                ? `<span class="badgeTag ok">Despachado</span>`
                : `<span class="badgeTag warn">Pendiente</span>`
          }</td>
        </tr>
      `;
      })
      .join("");

    body.querySelectorAll("[data-fulfill-line]").forEach((inp) => {
      inp.oninput = () => {
        const id = inp.dataset.fulfillLine;
        const val = Number(inp.value || 0);
        const max = Number(inp.max || 0);
        const finalVal = max ? Math.min(val, max) : val;
        if (val !== finalVal) inp.value = String(finalVal);
        // solo actualizamos el preview local cuando se despacha
      };
    });

    body.querySelectorAll("[data-fulfill-one]").forEach((btn) => {
      btn.onclick = async () => {
        const idLine = Number(btn.dataset.fulfillOne);
        if (!idLine || pedDispatchLineInFlight.has(idLine)) return;
        const input = body.querySelector(`[data-fulfill-line='${idLine}']`);
        if (!input) return;
        const max = Number(input.max || 0);
        const pending = Number(input.dataset.pending || 0);
        const val = Number(input.value || 0);
        if (!val || val <= 0) {
          showEntToast("Ingresa cantidad a despachar.", "bad");
          markError(input);
          return;
        }
        if (max && val > max) {
          showEntToast("No puedes despachar mas que el stock disponible.", "bad");
          markError(input);
          return;
        }
        const justificacion = getDispatchJustificacion();
        if (pending > 0 && val < pending && !justificacion) {
          showEntToast("Para despacho parcial debes escribir una justificacion.", "bad");
          markError($("#pedDispatchJustificacion"));
          return;
        }
        const orderId = Number(dispatchOrderId);
        if (!Number.isFinite(orderId) || orderId <= 0) {
          await uiConfirm("Pedido invalido para despacho.", "Error de despacho");
          return;
        }
        pedDispatchLineInFlight.add(idLine);
        btn.disabled = true;
        showSavingProgressToast(`despacho de linea #${idLine}`);
        try {
          const rr = await fetch(`/api/orders/${orderId}/fulfill`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + token,
            },
            body: JSON.stringify({
              lines: [{ id_pedido_detalle: idLine, qty: val }],
              justificacion: justificacion || null,
            }),
          });
          const jj = await rr.json().catch(() => ({}));
          if (!rr.ok) {
            showEntToast(jj.error || "Error al despachar.", "bad");
            return;
          }
          if (Array.isArray(jj.skipped) && jj.skipped.length) {
            showEntToast(`Se omitieron ${jj.skipped.length} productos por falta de stock.`, "bad");
          }
          const key = `${orderId}:${idLine}`;
          dispatchTodayMap.set(key, (dispatchTodayMap.get(key) || 0) + val);
          showEntToast(
            jj.status === "COMPLETADO_JUSTIFICADO"
              ? `Pedido #${orderId} despachado con justificacion`
              : `Pedido #${orderId} despachado (${jj.status})`,
            "ok"
          );
          const wrap = modal?.querySelector ? modal.querySelector(".tableWrap") : null;
          const scrollTop = wrap ? wrap.scrollTop : 0;
          await openDispatchModal(orderId, {
            keepScrollTop: scrollTop,
            focusLineId: idLine,
          });
          loadPedidosDespachar();
        } catch {
          showEntToast("Error de red.", "bad");
        } finally {
          pedDispatchLineInFlight.delete(idLine);
          if (btn.isConnected) btn.disabled = false;
        }
      };
    });

    body.querySelectorAll("[data-cancel-one]").forEach((btn) => {
      btn.onclick = async () => {
        const idLine = Number(btn.dataset.cancelOne);
        if (!idLine) return;
        const justificacion = getDispatchJustificacion();
        if (!justificacion) {
          showEntToast("Para no despachar una linea debes escribir una justificacion.", "bad");
          markError($("#pedDispatchJustificacion"));
          return;
        }
        if (!(await uiConfirm("Marcar esta linea como no despachada?", "Confirmar no despachado"))) return;
        try {
          const rr = await fetch(`/api/orders/${dispatchOrderId}/cancel-line`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + token,
            },
            body: JSON.stringify({
              id_pedido_detalle: idLine,
              justificacion,
            }),
          });
          const jj = await rr.json().catch(() => ({}));
          if (!rr.ok) {
            showEntToast(jj.error || "No se pudo marcar la linea como no despachada.", "bad");
            return;
          }
          showEntToast("Linea marcada como no despachada.", "ok");
          const wrap = modal?.querySelector ? modal.querySelector(".tableWrap") : null;
          const scrollTop = wrap ? wrap.scrollTop : 0;
          await openDispatchModal(orderId, {
            keepScrollTop: scrollTop,
            focusLineId: idLine,
          });
          loadPedidosDespachar();
        } catch {
          showEntToast("Error de red.", "bad");
        }
      };
    });

    body.querySelectorAll("[data-revert-one]").forEach((btn) => {
      btn.onclick = async () => {
        const idLine = Number(btn.dataset.revertOne);
        if (!idLine) return;
        const isCanceled = String(btn.dataset.isCanceled || "0") === "1";
        if (isCanceled) {
          if (!(await uiConfirm("Habilitar nuevamente esta linea anulada?", "Rehabilitar linea"))) return;
          try {
            const rr = await fetch(`/api/orders/${dispatchOrderId}/uncancel-line`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + token,
              },
              body: JSON.stringify({ id_pedido_detalle: idLine }),
            });
            const jj = await rr.json().catch(() => ({}));
            if (!rr.ok) {
              showEntToast(jj.error || "No se pudo rehabilitar la linea.", "bad");
              return;
            }
            showEntToast("Linea habilitada nuevamente.", "ok");
            const wrap = modal?.querySelector ? modal.querySelector(".tableWrap") : null;
            const scrollTop = wrap ? wrap.scrollTop : 0;
            await openDispatchModal(orderId, {
              keepScrollTop: scrollTop,
              focusLineId: idLine,
            });
            loadPedidosDespachar();
          } catch {
            showEntToast("Error de red.", "bad");
          }
          return;
        }
        if (!(await uiConfirm("Revertir esta linea? (Solo el mismo dia)\n\n⚠ ADVERTENCIA: Si la bodega destino ya recibio o uso el producto, el stock quedara INCONSISTENTE. Solo revierte si estas seguro.", "Confirmar reversion"))) return;
        try {
          let payload = { id_pedido_detalle: idLine };
          let rr = await fetch(`/api/orders/${dispatchOrderId}/revert-line`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + token,
            },
            body: JSON.stringify(payload),
          });
          let jj = await rr.json().catch(() => ({}));
          if (!rr.ok && (jj.code === "SENSITIVE_APPROVAL_REQUIRED" || jj.code === "SUPERVISOR_PIN_REQUIRED")) {
            const ap = await promptSensitiveApproval("reversion de linea");
            if (!ap) {
              showEntToast("Reversion cancelada: falta validacion de supervisor.", "bad");
              return;
            }
            payload = { ...payload, ...ap };
            rr = await fetch(`/api/orders/${dispatchOrderId}/revert-line`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + token,
              },
              body: JSON.stringify(payload),
            });
            jj = await rr.json().catch(() => ({}));
          }
          if (!rr.ok) {
            showEntToast(jj.error || "Error al revertir.", "bad");
            return;
          }
          showSupervisorAuthBadge(jj.sensitive_approval);
          const key = `${orderId}:${idLine}`;
          dispatchTodayMap.set(key, Math.max(0, (dispatchTodayMap.get(key) || 0) - (jj.reverted_qty || 0)));
          showEntToast("Linea revertida.", "ok");
          const wrap = modal?.querySelector ? modal.querySelector(".tableWrap") : null;
          const scrollTop = wrap ? wrap.scrollTop : 0;
          await openDispatchModal(orderId, {
            keepScrollTop: scrollTop,
            focusLineId: idLine,
          });
          loadPedidosDespachar();
        } catch {
          showEntToast("Error de red.", "bad");
        }
      };
    });
    const wrap = modal?.querySelector ? modal.querySelector(".tableWrap") : null;
    if (wrap && Number.isFinite(Number(opts.keepScrollTop))) {
      wrap.scrollTop = Number(opts.keepScrollTop);
    }
    if (opts.focusLineId) {
      const focusInput = body.querySelector(`[data-fulfill-line='${Number(opts.focusLineId)}']`);
      if (focusInput) {
        focusInput.focus();
        focusInput.scrollIntoView({ block: "center" });
      }
    }
  } catch {
    body.innerHTML = `<tr><td colspan="8">Error de red</td></tr>`;
  }
}

function closeDispatchModal() {
  dispatchOrderId = null;
  $("#pedDispatchModal")?.classList.add("hidden");
  if ($("#pedDispatchJustificacion")) $("#pedDispatchJustificacion").value = "";
}

if ($("#pedDispatchClose")) $("#pedDispatchClose").onclick = closeDispatchModal;
if ($("#pedDispatchCancel")) $("#pedDispatchCancel").onclick = closeDispatchModal;

if ($("#pedDispatchConfirm")) {
  $("#pedDispatchConfirm").onclick = async () => {
    if (pedDispatchBatchInFlight) return;
    if (!dispatchOrderId) return;
    const body = $("#pedDispatchLines");
    const inputs = Array.from(body?.querySelectorAll("[data-fulfill-line]") || []);
    const linesWithMeta = inputs
      .map((inp) => ({
        id_pedido_detalle: Number(inp.dataset.fulfillLine),
        qty: Number(inp.value || 0),
        pending: Number(inp.dataset.pending || 0),
      }))
      .filter((x) => Number.isFinite(x.id_pedido_detalle) && x.id_pedido_detalle > 0 && Number.isFinite(x.qty) && x.qty > 0);
    const lines = linesWithMeta.map((x) => ({ id_pedido_detalle: x.id_pedido_detalle, qty: x.qty }));

    if (!lines.length) {
      showEntToast("Ingresa cantidades a despachar.", "bad");
      return;
    }

    for (const inp of inputs) {
      const max = Number(inp.max || 0);
      const val = Number(inp.value || 0);
      if (max && val > max) {
        showEntToast("No puedes despachar mas que el stock disponible.", "bad");
        markError(inp);
        return;
      }
    }
    const needsJustificacion = linesWithMeta.some((ln) => ln.pending > 0 && ln.qty < ln.pending);
    const justificacion = getDispatchJustificacion();
    if (needsJustificacion && !justificacion) {
      showEntToast("Para despacho parcial debes escribir una justificacion.", "bad");
      markError($("#pedDispatchJustificacion"));
      return;
    }
    const orderId = Number(dispatchOrderId);
    if (!Number.isFinite(orderId) || orderId <= 0) {
      await uiConfirm("Pedido invalido para despacho.", "Error de despacho");
      return;
    }
    if (!(await uiConfirm("Estas seguro de despachar todo el pedido?", "Confirmar despacho"))) return;

    pedDispatchBatchInFlight = true;
    const dispatchBtn = $("#pedDispatchConfirm");
    if (dispatchBtn) {
      dispatchBtn.disabled = true;
      dispatchBtn.classList.add("is-loading");
    }
    showSavingProgressToast(`despacho de pedido #${orderId}`);
    try {
      const rr = await fetch(`/api/orders/${orderId}/fulfill`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ lines, justificacion: justificacion || null }),
      });
      const jj = await rr.json().catch(() => ({}));
      if (!rr.ok) {
        await uiConfirm(jj.error || "Error al despachar.", "Error de despacho");
        return;
      }
      if (Array.isArray(jj.skipped) && jj.skipped.length) {
        showEntToast(`Se omitieron ${jj.skipped.length} productos por falta de stock.`, "bad");
      }
      lines.forEach((ln) => {
        const key = `${orderId}:${ln.id_pedido_detalle}`;
        dispatchTodayMap.set(key, (dispatchTodayMap.get(key) || 0) + Number(ln.qty || 0));
      });
      showEntToast(
        jj.status === "COMPLETADO_JUSTIFICADO"
          ? `Pedido #${orderId} despachado con justificacion`
          : `Pedido #${orderId} despachado (${jj.status})`,
        "ok"
      );
      closeDispatchModal();
      loadPedidosDespachar();
    } catch {
      await uiConfirm("Error de red.", "Error de red");
    } finally {
      pedDispatchBatchInFlight = false;
      if (dispatchBtn) {
        dispatchBtn.disabled = false;
        dispatchBtn.classList.remove("is-loading");
      }
    }
  };
}

async function openLotsModal(id) {
  const modal = $("#pedLotsModal");
  const info = $("#pedLotsInfo");
  const body = $("#pedLotsList");
  if (!modal || !body) return;
  modal.classList.remove("hidden");
  body.innerHTML = `<tr><td colspan="6">Cargando...</td></tr>`;
  try {
    const r = await fetch(`/api/orders/${id}/lots`, {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      body.innerHTML = `<tr><td colspan="6">Error al cargar</td></tr>`;
      return;
    }
    info.textContent = `Pedido #${id} - ${j.count || 0} lotes`;
    const rows = j.rows || [];
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="6">Sin lotes despachados.</td></tr>`;
      return;
    }
    body.innerHTML = rows
      .map(
        (x) => `
        <tr>
          <td>${x.nombre_producto}</td>
          <td>${x.lote || ""}</td>
          <td>${fmtDateOnly(x.fecha_vencimiento)}</td>
          <td>${x.cantidad}</td>
          <td>${x.tipo_movimiento}</td>
          <td>${fmtDateTime(x.creado_en)}</td>
        </tr>
      `
      )
      .join("");
  } catch {
    body.innerHTML = `<tr><td colspan="6">Error de red</td></tr>`;
  }
}

function closeLotsModal() {
  $("#pedLotsModal")?.classList.add("hidden");
}

if ($("#pedLotsClose")) $("#pedLotsClose").onclick = closeLotsModal;
if ($("#pedLotsOk")) $("#pedLotsOk").onclick = closeLotsModal;







/* ===== Cuadre Caja ===== */
const CUADRE_DENOMS = [0.25, 0.5, 1, 5, 10, 20, 50, 100, 200];
const CUADRE_DOLAR_DENOM_USD = 1;
const CUADRE_DOLAR_TIPO_CAMBIO = 7.3;
const CUADRE_VENTAS_SUGERIDAS = [
  "Flor de Cafe",
  "Restaurante",
  "Nilas",
];
let cuadreDynamicDenoms = [...CUADRE_DENOMS];

function cuadreTodayYmd() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function ensurePedidoFechaHoraAutomatica(){
  const fecha = $("#pedFecha");
  const hora = $("#pedHora");
  if (fecha) {
    fecha.setAttribute("readonly", "readonly");
    fecha.setAttribute("aria-readonly", "true");
    fecha.disabled = true;
  }
  if (hora) {
    hora.setAttribute("readonly", "readonly");
    hora.setAttribute("aria-readonly", "true");
    hora.disabled = true;
  }
}

function startPedidoNowTicker(){
  if (pedNowTimer) clearInterval(pedNowTimer);
  ensurePedidoFechaHoraAutomatica();
  setFechaHoraPedidoActual();
  pedNowTimer = setInterval(() => {
    if (currentSection === "pedidos") setFechaHoraPedidoActual();
  }, 15000);
}

function cuadreParseNum(v) {
  const raw = String(v ?? "").replace(/,/g, "").trim();
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function cuadreFormatDenomLabel(value) {
  const num = Math.max(0, cuadreParseNum(value));
  const normalized = Number(num.toFixed(2));
  return normalized % 1 === 0 ? String(normalized.toFixed(0)) : normalized.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function normalizeCuadreDenoms(values = []) {
  const seen = new Set();
  const merged = [...CUADRE_DENOMS, ...(Array.isArray(values) ? values : [])]
    .map((v) => Number(cuadreParseNum(v).toFixed(2)))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  return merged.filter((v) => {
    const key = v.toFixed(2);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cuadreDraftStorageKey() {
  const userKey = String(me?.id_user || me?.username || me?.full_name || "anon").trim() || "anon";
  return `cuadre-caja-draft:${userKey}`;
}

function cuadreAmbienteKey(name) {
  const raw = String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
  if (!raw) return null;
  if (raw.includes("flor") && raw.includes("cafe")) return "flor_cafe";
  if (raw === "restaurante") return "restaurante";
  if (raw === "nilas") return "nilas";
  if (raw === "eldeck" || raw === "eldeck") return "eldeck";
  if (raw === "cactus") return "cactus";
  if (raw === "gelato") return "gelato";
  if (raw === "jazmin") return "jazmin";
  return null;
}

function getSelectedCuadreWarehouseId() {
  const sel = $("#cuadreWarehouse");
  const current = Number(sel?.value || 0);
  if (current > 0) return current;
  if (cuadreCanAllBodegas) return 0;
  const first = Number(sel?.options?.[0]?.value || 0);
  return first > 0 ? first : 0;
}

function buildCuadreDefaultPayload() {
  const monedas = {};
  normalizeCuadreDenoms(CUADRE_DENOMS).forEach((d) => {
    monedas[String(d)] = 0;
  });
  return {
    sede: "",
    responsable: String(me?.full_name || "").trim(),
    monedas,
    pagos: {
      dolares_cantidad: 0,
      visa: 0,
      bancos: 0,
      cxc_trabajadores: 0,
      cxc_habitaciones: 0,
      pase_consumible: 0,
    },
    ventas_rows: CUADRE_VENTAS_SUGERIDAS.map((x) => ({ ambiente: x, monto: 0 })),
    extras: {
      pedidos_nilas: 0,
      cortesias: 0,
    },
    detalle: [],
  };
}

function normalizeCuadreDetailRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      descripcion: String(row?.descripcion || "").trim(),
      nombre: String(row?.nombre || "").trim(),
      monto: Math.max(0, cuadreParseNum(row?.monto || 0)),
      check_no: String(row?.check_no || "").trim(),
    }))
    .filter((row) => row.descripcion || row.nombre || row.monto > 0 || row.check_no)
    .slice(0, 250);
}

function normalizeCuadreVentasRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      ambiente: String(row?.ambiente || "").trim(),
      monto: Math.max(0, cuadreParseNum(row?.monto || 0)),
    }))
    .filter((row) => row.ambiente || row.monto > 0)
    .slice(0, 250);
}

function getCuadreMonedasFromDom() {
  const monedas = {};
  document.querySelectorAll("[data-cuadre-denom]").forEach((input) => {
    const denom = Number(input?.dataset?.cuadreDenom || 0);
    if (denom <= 0) return;
    monedas[String(Number(denom.toFixed(2)))] = Math.max(0, cuadreParseNum(input.value || 0));
  });
  return monedas;
}

function getCuadreDollarQtyFromDom() {
  return Math.max(0, cuadreParseNum(document.querySelector("[data-cuadre-dollar-qty]")?.value || 0));
}

function renderCuadreCashRows(sourceMonedas = null, sourceDollarQty = null) {
  const tb = $("#cuadreCashRows");
  if (!tb) return;
  const monedas = sourceMonedas && typeof sourceMonedas === "object" ? sourceMonedas : getCuadreMonedasFromDom();
  const dollarQty = sourceDollarQty === null ? getCuadreDollarQtyFromDom() : Math.max(0, cuadreParseNum(sourceDollarQty || 0));
  cuadreDynamicDenoms = normalizeCuadreDenoms(Object.keys(monedas).map((k) => cuadreParseNum(k)));
  const rows = cuadreDynamicDenoms
    .map((d) => {
      const label = cuadreFormatDenomLabel(d);
      const isBase = CUADRE_DENOMS.some((base) => Number(base.toFixed(2)) === Number(d.toFixed(2)));
      const qty = Math.max(0, cuadreParseNum(monedas[String(d)] || 0));
      return `
      <tr>
        <td class="cuadreDenomCol cuadreDenomCol-label"><span class="cuadreDenomBadge">Q${escapeHtml(label)}</span></td>
        <td class="cuadreDenomCol cuadreDenomCol-qty"><input class="in cuadreQtyInput" data-cuadre-denom="${label}" type="number" min="0" step="1" value="${String(qty)}" placeholder="0" /></td>
        <td class="cuadreDenomCol cuadreDenomCol-total"><span class="cuadreLineTotal" data-cuadre-line-total="${label}">${fmtMoney(qty * d)}</span></td>
        <td class="cuadreDenomCol cuadreDenomCol-action">${isBase ? `<span class="pill ghost">Base</span>` : `<button class="btn soft btn-sm" data-cuadre-denom-remove="${label}" type="button">Quitar</button>`}</td>
      </tr>
    `;
    });
  rows.push(`
      <tr>
        <td class="cuadreDenomCol cuadreDenomCol-label"><span class="cuadreDenomBadge">$${escapeHtml(String(CUADRE_DOLAR_DENOM_USD))}</span></td>
        <td class="cuadreDenomCol cuadreDenomCol-qty"><input class="in cuadreQtyInput" data-cuadre-dollar-qty="1" type="number" min="0" step="1" value="${String(dollarQty)}" placeholder="0" /></td>
        <td class="cuadreDenomCol cuadreDenomCol-total"><span class="cuadreLineTotal" data-cuadre-dollar-total="1">$${fmtMoney(dollarQty * CUADRE_DOLAR_DENOM_USD)}</span></td>
        <td class="cuadreDenomCol cuadreDenomCol-action"><span class="pill ghost">Q${fmtMoney(CUADRE_DOLAR_TIPO_CAMBIO)}</span></td>
      </tr>
    `);
  tb.innerHTML = rows.join("");
}

function renderCuadreDetailRows(rows = []) {
  const tb = $("#cuadreDetailList");
  if (!tb) return;
  const sourceRows = Array.isArray(rows) ? rows : [];
  cuadreDetailRows = normalizeCuadreDetailRows(sourceRows);
  const renderRows = sourceRows.length
    ? sourceRows.map((row) => ({
        descripcion: String(row?.descripcion || "").trim(),
        nombre: String(row?.nombre || "").trim(),
        monto: Math.max(0, cuadreParseNum(row?.monto || 0)),
        check_no: String(row?.check_no || "").trim(),
      }))
    : [{ descripcion: "", nombre: "", monto: 0, check_no: "" }];
  tb.innerHTML = renderRows
    .map(
      (row, idx) => `
      <tr>
        <td><input class="in" data-cuadre-detail-field="descripcion" data-cuadre-detail-idx="${idx}" value="${escapeHtml(row.descripcion)}" placeholder="Ej. Cortesia funcionarios" /></td>
        <td><input class="in" data-cuadre-detail-field="nombre" data-cuadre-detail-idx="${idx}" value="${escapeHtml(row.nombre)}" placeholder="Nombre o referencia" /></td>
        <td><input class="in" data-cuadre-detail-field="monto" data-cuadre-detail-idx="${idx}" type="number" min="0" step="0.01" value="${String(row.monto || 0)}" /></td>
        <td><input class="in" data-cuadre-detail-field="check_no" data-cuadre-detail-idx="${idx}" value="${escapeHtml(row.check_no)}" placeholder="Check o nota" /></td>
        <td><button class="btn soft btn-sm" data-cuadre-detail-remove="${idx}" type="button">Quitar</button></td>
      </tr>
    `
    )
    .join("");
}

function renderCuadreVentasRows(rows = []) {
  const tb = $("#cuadreVentasList");
  if (!tb) return;
  const sourceRows = Array.isArray(rows) ? rows : [];
  const out = normalizeCuadreVentasRows(sourceRows);
  const renderRows = sourceRows.length
    ? sourceRows.map((row) => ({
        ambiente: String(row?.ambiente || "").trim(),
        monto: Math.max(0, cuadreParseNum(row?.monto || 0)),
      }))
    : (out.length ? out : [{ ambiente: "", monto: 0 }]);
  tb.innerHTML = renderRows
    .map(
      (row, idx) => `
      <tr>
        <td><input class="in" data-cuadre-venta-field="ambiente" data-cuadre-venta-idx="${idx}" value="${escapeHtml(row.ambiente)}" placeholder="Ej. Restaurante" /></td>
        <td><input class="in" data-cuadre-venta-field="monto" data-cuadre-venta-idx="${idx}" type="number" min="0" step="0.01" value="${String(row.monto || 0)}" /></td>
        <td><button class="btn soft btn-sm" data-cuadre-venta-remove="${idx}" type="button">Quitar</button></td>
      </tr>
    `
    )
    .join("");
}

function collectCuadreDetailRowsFromDom() {
  const tb = $("#cuadreDetailList");
  if (!tb) return [];
  const rows = Array.from(tb.querySelectorAll("tr"));
  const out = rows
    .map((tr) => {
      const descripcion = String(tr.querySelector('[data-cuadre-detail-field="descripcion"]')?.value || "").trim();
      const nombre = String(tr.querySelector('[data-cuadre-detail-field="nombre"]')?.value || "").trim();
      const monto = Math.max(0, cuadreParseNum(tr.querySelector('[data-cuadre-detail-field="monto"]')?.value || 0));
      const check_no = String(tr.querySelector('[data-cuadre-detail-field="check_no"]')?.value || "").trim();
      if (!descripcion && !nombre && !monto && !check_no) return null;
      return { descripcion, nombre, monto, check_no };
    })
    .filter(Boolean);
  cuadreDetailRows = out;
  return out;
}

function collectCuadreVentasRowsFromDom() {
  const tb = $("#cuadreVentasList");
  if (!tb) return [];
  const rows = Array.from(tb.querySelectorAll("tr"));
  return rows
    .map((tr) => {
      const ambiente = String(tr.querySelector('[data-cuadre-venta-field="ambiente"]')?.value || "").trim();
      const monto = Math.max(0, cuadreParseNum(tr.querySelector('[data-cuadre-venta-field="monto"]')?.value || 0));
      if (!ambiente && !monto) return null;
      return { ambiente, monto };
    })
    .filter(Boolean)
    .slice(0, 250);
}

function setCuadreNumberValue(id, value) {
  const el = $(id);
  if (!el) return;
  el.value = String(Number.isFinite(Number(value)) ? Number(value) : 0);
}

function ventasRowsFromPayload(payload = {}) {
  if (Array.isArray(payload.ventas_rows) && payload.ventas_rows.length) {
    return normalizeCuadreVentasRows(payload.ventas_rows);
  }
  const ventasObj = payload.ventas && typeof payload.ventas === "object" ? payload.ventas : {};
  const fromKnown = [
    ["Flor de Cafe", Number(ventasObj.flor_cafe || 0)],
    ["Restaurante", Number(ventasObj.restaurante || 0)],
    ["Nilas", Number(ventasObj.nilas || 0)],
  ].map(([ambiente, monto]) => ({ ambiente, monto }));
  return normalizeCuadreVentasRows(fromKnown);
}

function cuadreWritePreviewLines(targetId, lines = [], emptyText = "Sin datos") {
  const target = $(targetId);
  if (!target) return;
  if (!lines.length) {
    target.innerHTML = `<div class="cuadreTicketEmpty">${escapeHtml(emptyText)}</div>`;
    return;
  }
  target.innerHTML = lines.map((line) => `<div class="cuadreTicketLine"><span>${escapeHtml(line.label)}</span><strong>${escapeHtml(line.value)}</strong></div>`).join("");
}

function renderCuadreTicketPreview(snapshot = {}) {
  const fecha = $("#cuadreFecha")?.value || cuadreTodayYmd();
  const bodegaTxt = $("#cuadreWarehouse")?.selectedOptions?.[0]?.textContent?.trim() || $("#cuadreSede")?.value?.trim() || "-";
  const responsable = String($("#cuadreResponsable")?.value || me?.full_name || "").trim() || "-";
  if ($("#cuadrePreviewFecha")) $("#cuadrePreviewFecha").textContent = fecha ? fmtDateOnly(fecha) : "-";
  if ($("#cuadrePreviewBodega")) $("#cuadrePreviewBodega").textContent = bodegaTxt;
  if ($("#cuadrePreviewResponsable")) $("#cuadrePreviewResponsable").textContent = responsable;

  const monedas = snapshot.monedas && typeof snapshot.monedas === "object" ? snapshot.monedas : getCuadreMonedasFromDom();
  const cashLines = normalizeCuadreDenoms(Object.keys(monedas).map((k) => cuadreParseNum(k)))
    .map((d) => {
      const qty = Math.max(0, cuadreParseNum(monedas[String(d)] || 0));
      if (qty <= 0) return null;
      return { label: `Q${cuadreFormatDenomLabel(d)} x ${qty}`, value: fmtMoney(qty * d) };
    })
    .filter(Boolean);
  const dolaresCantidad = Math.max(0, cuadreParseNum(getCuadreDollarQtyFromDom() || 0));
  if (dolaresCantidad > 0) {
    cashLines.push({
      label: `$${CUADRE_DOLAR_DENOM_USD} x ${dolaresCantidad}`,
      value: `$${fmtMoney(dolaresCantidad * CUADRE_DOLAR_DENOM_USD)}`,
    });
  }
  cuadreWritePreviewLines("#cuadrePreviewCashLines", cashLines, "Sin denominaciones capturadas");

  const paymentLines = [
    ["Visa", "#cuadreVisa"],
    ["Bancos", "#cuadreBancos"],
    ["CxC Trabajadores", "#cuadreCxcTrabajadores"],
    ["CxC Habitaciones", "#cuadreCxcHabitaciones"],
    ["Pase Consumible", "#cuadrePaseConsumible"],
  ]
    .map(([label, id]) => ({ label, amount: Math.max(0, cuadreParseNum($(id)?.value || 0)) }))
    .filter((line) => line.amount > 0)
    .map((line) => ({ label: line.label, value: fmtMoney(line.amount) }));
  cuadreWritePreviewLines("#cuadrePreviewPaymentLines", paymentLines, "Sin otros cobros");

  const ventasLines = collectCuadreVentasRowsFromDom()
    .filter((row) => row.ambiente || row.monto > 0)
    .map((row) => ({ label: row.ambiente || "Ambiente", value: fmtMoney(row.monto || 0) }));
  cuadreWritePreviewLines("#cuadrePreviewVentasLines", ventasLines, "Sin ambientes capturados");

  if ($("#cuadrePreviewTotalDolaresQtz")) $("#cuadrePreviewTotalDolaresQtz").textContent = fmtMoney(snapshot.total_dolares_quetzales || 0);
  if ($("#cuadrePreviewTotalEfectivo")) $("#cuadrePreviewTotalEfectivo").textContent = fmtMoney(snapshot.total_efectivo || 0);
  if ($("#cuadrePreviewTotalCobro")) $("#cuadrePreviewTotalCobro").textContent = fmtMoney(snapshot.total_cobro || 0);
  if ($("#cuadrePreviewPedidosNilas")) $("#cuadrePreviewPedidosNilas").textContent = fmtMoney(snapshot.pedidos_nilas || 0);
  if ($("#cuadrePreviewCortesias")) $("#cuadrePreviewCortesias").textContent = fmtMoney(snapshot.cortesias || 0);
  if ($("#cuadrePreviewGranTotal")) $("#cuadrePreviewGranTotal").textContent = fmtMoney(snapshot.gran_total_reporte || 0);
  if ($("#cuadrePreviewMetaNote")) $("#cuadrePreviewMetaNote").textContent = `Borrador local del usuario ${responsable}.`;
}

function buildVentasObjectFromRows(ventasRows = []) {
  const ventas = {
    flor_cafe: 0,
    restaurante: 0,
    nilas: 0,
    eldeck: 0,
    cactus: 0,
    gelato: 0,
    jazmin: 0,
  };
  (Array.isArray(ventasRows) ? ventasRows : []).forEach((row) => {
    const key = cuadreAmbienteKey(row.ambiente);
    if (!key) return;
    ventas[key] = Number(ventas[key] || 0) + Number(row.monto || 0);
  });
  return ventas;
}

function buildCuadrePayloadFromUI() {
  const monedas = getCuadreMonedasFromDom();
  const ventas_rows = collectCuadreVentasRowsFromDom();
  const ventas = buildVentasObjectFromRows(ventas_rows);
  return {
    sede: String($("#cuadreSede")?.value || "").trim(),
    responsable: String(me?.full_name || "").trim(),
    monedas,
    pagos: {
      dolares_cantidad: Math.max(0, cuadreParseNum(getCuadreDollarQtyFromDom() || 0)),
      visa: Math.max(0, cuadreParseNum($("#cuadreVisa")?.value || 0)),
      bancos: Math.max(0, cuadreParseNum($("#cuadreBancos")?.value || 0)),
      cxc_trabajadores: Math.max(0, cuadreParseNum($("#cuadreCxcTrabajadores")?.value || 0)),
      cxc_habitaciones: Math.max(0, cuadreParseNum($("#cuadreCxcHabitaciones")?.value || 0)),
      pase_consumible: Math.max(0, cuadreParseNum($("#cuadrePaseConsumible")?.value || 0)),
    },
    ventas,
    ventas_rows,
    extras: {
      pedidos_nilas: Math.max(0, cuadreParseNum($("#cuadrePedidosNilas")?.value || 0)),
      cortesias: Math.max(0, cuadreParseNum($("#cuadreCortesias")?.value || 0)),
    },
    detalle: collectCuadreDetailRowsFromDom(),
  };
}

function saveCuadreDraftLocal() {
  if (!$("#view-cuadre-caja")) return;
  try {
    const draft = {
      fecha: $("#cuadreFecha")?.value || cuadreTodayYmd(),
      id_bodega: Number($("#cuadreWarehouse")?.value || 0),
      payload: buildCuadrePayloadFromUI(),
      updated_at: new Date().toISOString(),
    };
    localStorage.setItem(cuadreDraftStorageKey(), JSON.stringify(draft));
  } catch (e) { console.error('unknown:', e); }
}

function loadCuadreDraftLocal() {
  try {
    const raw = localStorage.getItem(cuadreDraftStorageKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function clearCuadreDraftLocal() {
  try {
    localStorage.removeItem(cuadreDraftStorageKey());
  } catch (e) { console.error('unknown:', e); }
}

function applyCuadrePayload(payload = {}) {
  const base = buildCuadreDefaultPayload();
  const rawPayload = payload && typeof payload === "object" ? payload : {};
  const data = {
    ...base,
    ...rawPayload,
    monedas: {
      ...base.monedas,
      ...((rawPayload.monedas && typeof rawPayload.monedas === "object") ? rawPayload.monedas : {}),
    },
    pagos: {
      ...base.pagos,
      ...((rawPayload.pagos && typeof rawPayload.pagos === "object") ? rawPayload.pagos : {}),
      pase_consumible: Number((rawPayload.pagos && typeof rawPayload.pagos === "object") ? (rawPayload.pagos.pase_consumible ?? rawPayload.pagos.day ?? 0) : 0),
    },
    extras: {
      ...base.extras,
      ...((rawPayload.extras && typeof rawPayload.extras === "object") ? rawPayload.extras : {}),
    },
  };

  if ($("#cuadreSede")) $("#cuadreSede").value = String(data.sede || "");
  if ($("#cuadreResponsable")) $("#cuadreResponsable").value = String(me?.full_name || data.responsable || "").trim();

  renderCuadreCashRows(data.monedas || {}, data.pagos.dolares_cantidad || 0);
  setCuadreNumberValue("#cuadreVisa", data.pagos.visa || 0);
  setCuadreNumberValue("#cuadreBancos", data.pagos.bancos || 0);
  setCuadreNumberValue("#cuadreCxcTrabajadores", data.pagos.cxc_trabajadores || 0);
  setCuadreNumberValue("#cuadreCxcHabitaciones", data.pagos.cxc_habitaciones || 0);
  setCuadreNumberValue("#cuadrePaseConsumible", data.pagos.pase_consumible ?? (data.pagos.day || 0));
  setCuadreNumberValue("#cuadrePedidosNilas", data.extras.pedidos_nilas || 0);
  setCuadreNumberValue("#cuadreCortesias", data.extras.cortesias || 0);

  renderCuadreVentasRows(ventasRowsFromPayload(data));
  renderCuadreDetailRows(data.detalle || []);
  updateCuadreTotals();
}

function updateCuadreTotals() {
  let efectivoDenoms = 0;
  const monedas = getCuadreMonedasFromDom();
  normalizeCuadreDenoms(Object.keys(monedas).map((k) => cuadreParseNum(k))).forEach((d) => {
    const qty = Math.max(0, cuadreParseNum(monedas[String(d)] || 0));
    const line = qty * Number(d);
    efectivoDenoms += line;
    const label = document.querySelector(`[data-cuadre-line-total="${cuadreFormatDenomLabel(d)}"]`);
    if (label) label.textContent = fmtMoney(line);
  });

  const dolaresCantidad = Math.max(0, cuadreParseNum(getCuadreDollarQtyFromDom() || 0));
  const totalDolares = dolaresCantidad * CUADRE_DOLAR_DENOM_USD;
  const totalDolaresQuetzales = totalDolares * CUADRE_DOLAR_TIPO_CAMBIO;
  const visa = Math.max(0, cuadreParseNum($("#cuadreVisa")?.value || 0));
  const bancos = Math.max(0, cuadreParseNum($("#cuadreBancos")?.value || 0));
  const cxcTrab = Math.max(0, cuadreParseNum($("#cuadreCxcTrabajadores")?.value || 0));
  const cxcHab = Math.max(0, cuadreParseNum($("#cuadreCxcHabitaciones")?.value || 0));
  const paseConsumible = Math.max(0, cuadreParseNum($("#cuadrePaseConsumible")?.value || 0));

  const ventasRows = collectCuadreVentasRowsFromDom();
  const totalVentaAmbiente = ventasRows.reduce((acc, row) => acc + Number(row.monto || 0), 0);

  const pedidosNilas = Math.max(0, cuadreParseNum($("#cuadrePedidosNilas")?.value || 0));
  const cortesias = Math.max(0, cuadreParseNum($("#cuadreCortesias")?.value || 0));

  const totalEfectivo = efectivoDenoms + totalDolaresQuetzales;
  const totalCobro = totalEfectivo + visa + bancos + cxcTrab + cxcHab + paseConsumible;
  const granTotal = totalVentaAmbiente + pedidosNilas + cortesias;

  const dollarLine = document.querySelector("[data-cuadre-dollar-total]");
  if (dollarLine) dollarLine.textContent = `$${fmtMoney(totalDolares)}`;
  if ($("#cuadreTotalEfectivo")) $("#cuadreTotalEfectivo").textContent = fmtMoney(totalEfectivo);
  if ($("#cuadreTotalCobro")) $("#cuadreTotalCobro").textContent = fmtMoney(totalCobro);
  if ($("#cuadreTotalVentaAmbiente")) $("#cuadreTotalVentaAmbiente").textContent = fmtMoney(totalVentaAmbiente);
  if ($("#cuadreGranTotal")) $("#cuadreGranTotal").textContent = fmtMoney(granTotal);

  const snapshot = {
    monedas,
    total_dolares: totalDolares,
    total_dolares_quetzales: totalDolaresQuetzales,
    total_efectivo: totalEfectivo,
    total_cobro: totalCobro,
    total_venta_ambiente: totalVentaAmbiente,
    pedidos_nilas: pedidosNilas,
    cortesias,
    gran_total_reporte: granTotal,
  };
  renderCuadreTicketPreview(snapshot);
  saveCuadreDraftLocal();
  return snapshot;
}

async function loadCuadreWarehouseFilter(force = false) {
  const sel = $("#cuadreWarehouse");
  if (!sel) return;
  if (cuadreWarehouseLoaded && !force) return;
  try {
    const r = await fetch("/api/cuadre-caja/context", {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return;

    const rows = Array.isArray(j.bodegas) ? j.bodegas : [];
    cuadreCanAllBodegas = Number(j.can_all_bodegas) === 1 || j.can_all_bodegas === true;
    sel.innerHTML = rows.map((b) => `<option value="${b.id_bodega}">${escapeHtml(b.nombre_bodega || "")}</option>`).join("");
    sel.disabled = !cuadreCanAllBodegas;

    if (Number(j.id_bodega_default || 0) > 0) {
      sel.value = String(j.id_bodega_default);
    } else if (rows[0]?.id_bodega) {
      sel.value = String(rows[0].id_bodega);
    }

    const draft = loadCuadreDraftLocal();
    if (draft?.id_bodega && Array.from(sel.options).some((opt) => Number(opt.value || 0) === Number(draft.id_bodega || 0))) {
      sel.value = String(draft.id_bodega);
    }

    cuadreWarehouseLoaded = true;
  } catch (e) { console.error('loadCuadreCajaCatalogos:', e); }
}

async function loadCuadreCaja() {
  await loadCuadreWarehouseFilter();
  if ($("#cuadreFecha") && !$("#cuadreFecha").value) setDateInputValue($("#cuadreFecha"), cuadreTodayYmd());
  const fecha = $("#cuadreFecha")?.value || cuadreTodayYmd();
  const idBodega = Number($("#cuadreWarehouse")?.value || 0);
  const qs = new URLSearchParams({ fecha });
  if (idBodega > 0) qs.set("warehouse", String(idBodega));
  if ($("#cuadreMeta")) $("#cuadreMeta").textContent = "Cargando...";
  try {
    const r = await fetch(`/api/cuadre-caja?${qs.toString()}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if ($("#cuadreMeta")) $("#cuadreMeta").textContent = j.error || "Error";
      return;
    }

    applyCuadrePayload(j.payload || {});
    if ($("#cuadreSede") && !(String($("#cuadreSede").value || "").trim())) {
      $("#cuadreSede").value = String(j?.bodega || "").trim();
    }

    const when = j.actualizado_en ? ` | Actualizado: ${fmtDateTime(j.actualizado_en)}` : "";
    if ($("#cuadreMeta")) {
      $("#cuadreMeta").textContent = `${j.bodega || "Bodega"} | Fecha ${fmtDateOnly(j.fecha)}${when}`;
    }
    saveCuadreDraftLocal();
  } catch {
    if ($("#cuadreMeta")) $("#cuadreMeta").textContent = "Error de red";
  }
}

async function saveCuadreCaja() {
  if (cuadreSaveInFlight) return;
  if (!hasPerm("action.create_update")) {
    showEntToast("No tienes permiso para guardar el cuadre.", "bad");
    return;
  }

  const fecha = $("#cuadreFecha")?.value || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    showEntToast("Selecciona una fecha valida para el cuadre.", "bad");
    markError($("#cuadreFecha"));
    return;
  }

  const id_bodega = Number(getSelectedCuadreWarehouseId() || 0);
  if (!id_bodega) {
    showEntToast("Selecciona una bodega valida.", "bad");
    markError($("#cuadreWarehouse"));
    return;
  }

  const payload = buildCuadrePayloadFromUI();
  cuadreSaveInFlight = true;
  const btn = $("#cuadreSave");
  if (btn) btn.disabled = true;
  try {
    const r = await fetch("/api/cuadre-caja", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ fecha, id_bodega, payload }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      showEntToast(j.error || "No se pudo guardar el cuadre.", "bad");
      return;
    }
    applyCuadrePayload(j.payload || payload);
    updateCuadreTotals();
    showEntToast("Cuadre guardado correctamente.", "ok");
    await loadCuadreCaja();
  } catch {
    showEntToast("Error de red al guardar el cuadre.", "bad");
  } finally {
    cuadreSaveInFlight = false;
    if (btn) btn.disabled = !hasPerm("action.create_update");
  }
}

function clearCuadreCajaForm() {
  if ($("#cuadreFecha") && !$("#cuadreFecha").value) setDateInputValue($("#cuadreFecha"), cuadreTodayYmd());
  applyCuadrePayload(buildCuadreDefaultPayload());
  if ($("#cuadreSede") && !(String($("#cuadreSede").value || "").trim())) {
    const selectedTxt = $("#cuadreWarehouse")?.selectedOptions?.[0]?.textContent || "";
    $("#cuadreSede").value = String(selectedTxt || "").trim();
  }
  clearCuadreDraftLocal();
  if ($("#cuadreMeta")) $("#cuadreMeta").textContent = "Formulario limpio";
}

function openCuadrePrint(format = "carta") {
  const fecha = $("#cuadreFecha")?.value || cuadreTodayYmd();
  const idBodega = Number($("#cuadreWarehouse")?.value || 0);
  const fmt = String(format || "carta").toLowerCase() === "pos" ? "pos" : "carta";
  const targetName = `cuadrePrint_${Date.now()}`;
  const popup = window.open("", targetName);
  if (!popup) {
    showEntToast("El navegador bloqueo la ventana de impresion.", "bad");
    return;
  }
  const form = document.createElement("form");
  form.method = "POST";
  form.target = targetName;
  form.action = `${API_ORIGIN}/api/print/cuadre-caja?token=${encodeURIComponent(token || "")}`;
  form.style.display = "none";

  const fields = {
    fecha,
    format: fmt,
    warehouse: idBodega > 0 ? String(idBodega) : "",
    payload_override: JSON.stringify(buildCuadrePayloadFromUI()),
  };
  Object.entries(fields).forEach(([name, value]) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = String(value || "");
    form.appendChild(input);
  });

  document.body.appendChild(form);
  form.submit();
  setTimeout(() => form.remove(), 1000);
}

function openCuadrePdf() {
  const format = $("#cuadrePdfFormat")?.value || "carta";
  openCuadrePrint(format);
}
function initCuadreCajaDraft() {
  if (!$("#view-cuadre-caja")) return;
  const draft = loadCuadreDraftLocal();
  const base = buildCuadreDefaultPayload();
  renderCuadreCashRows(base.monedas, base.pagos.dolares_cantidad || 0);
  renderCuadreVentasRows(base.ventas_rows);
  renderCuadreDetailRows([]);
  if ($("#cuadreFecha") && !$("#cuadreFecha").value) setDateInputValue($("#cuadreFecha"), draft?.fecha || cuadreTodayYmd());
  applyCuadrePayload(draft?.payload || base);
}

if ($("#cuadreSearch")) {
  $("#cuadreSearch").onclick = loadCuadreCaja;
}
if ($("#cuadreClear")) {
  $("#cuadreClear").onclick = clearCuadreCajaForm;
}
if ($("#cuadrePrintPos")) {
  $("#cuadrePrintPos").onclick = () => openCuadrePrint("pos");
}
if ($("#cuadrePrintCarta")) {
  $("#cuadrePrintCarta").onclick = () => openCuadrePrint("carta");
}
if ($("#cuadreSavePdf")) {
  $("#cuadreSavePdf").onclick = openCuadrePdf;
}
if ($("#cuadreSave")) {
  $("#cuadreSave").onclick = saveCuadreCaja;
}
if ($("#cuadreFecha")) {
  if (!$("#cuadreFecha").value) setDateInputValue($("#cuadreFecha"), cuadreTodayYmd());
  $("#cuadreFecha").addEventListener("change", () => {
    saveCuadreDraftLocal();
    loadCuadreCaja();
  });
}
if ($("#cuadreWarehouse")) {
  $("#cuadreWarehouse").onchange = () => {
    saveCuadreDraftLocal();
    loadCuadreCaja();
  };
}
if ($("#cuadreCashRows")) {
  $("#cuadreCashRows").addEventListener("input", () => updateCuadreTotals());
  $("#cuadreCashRows").addEventListener("click", (e) => {
    const btn = e.target?.closest?.("[data-cuadre-denom-remove]");
    if (!btn) return;
    const target = Number(cuadreParseNum(btn.dataset.cuadreDenomRemove || 0).toFixed(2));
    if (target <= 0) return;
    const monedas = getCuadreMonedasFromDom();
    delete monedas[String(target)];
    renderCuadreCashRows(monedas);
    updateCuadreTotals();
  });
}
[
  "#cuadreVisa", "#cuadreBancos", "#cuadreCxcTrabajadores", "#cuadreCxcHabitaciones", "#cuadrePaseConsumible",
  "#cuadrePedidosNilas", "#cuadreCortesias", "#cuadreSede"
].forEach((id) => {
  const el = $(id);
  if (el) el.addEventListener("input", () => updateCuadreTotals());
});
if ($("#cuadreAddDenom")) {
  $("#cuadreAddDenom").onclick = () => {
    const input = $("#cuadreNewDenom");
    const denom = Number(cuadreParseNum(input?.value || 0).toFixed(2));
    if (!denom || denom <= 0) {
      showEntToast("Ingresa una denominacion valida.", "bad");
      markError(input);
      return;
    }
    const monedas = getCuadreMonedasFromDom();
    monedas[String(denom)] = monedas[String(denom)] || 0;
    renderCuadreCashRows(monedas);
    if (input) input.value = "";
    updateCuadreTotals();
  };
}
if ($("#cuadreNewDenom")) {
  $("#cuadreNewDenom").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $("#cuadreAddDenom")?.click();
    }
  });
}
if ($("#cuadreAddVentaRow")) {
  $("#cuadreAddVentaRow").onclick = () => {
    const rows = collectCuadreVentasRowsFromDom();
    rows.push({ ambiente: "", monto: 0 });
    renderCuadreVentasRows(rows);
    updateCuadreTotals();
  };
}
if ($("#cuadreVentasList")) {
  $("#cuadreVentasList").addEventListener("input", () => updateCuadreTotals());
  $("#cuadreVentasList").addEventListener("click", (e) => {
    const btn = e.target?.closest?.("[data-cuadre-venta-remove]");
    if (!btn) return;
    const idx = Number(btn.dataset.cuadreVentaRemove || -1);
    if (idx < 0) return;
    const rows = collectCuadreVentasRowsFromDom();
    rows.splice(idx, 1);
    renderCuadreVentasRows(rows);
    updateCuadreTotals();
  });
}
if ($("#cuadreAddDetailRow")) {
  $("#cuadreAddDetailRow").onclick = () => {
    const rows = collectCuadreDetailRowsFromDom();
    rows.push({ descripcion: "", nombre: "", monto: 0, check_no: "" });
    renderCuadreDetailRows(rows);
    saveCuadreDraftLocal();
  };
}
if ($("#cuadreDetailList")) {
  $("#cuadreDetailList").addEventListener("input", () => saveCuadreDraftLocal());
  $("#cuadreDetailList").addEventListener("click", (e) => {
    const btn = e.target?.closest?.("[data-cuadre-detail-remove]");
    if (!btn) return;
    const idx = Number(btn.dataset.cuadreDetailRemove || -1);
    if (idx < 0) return;
    const rows = collectCuadreDetailRowsFromDom();
    rows.splice(idx, 1);
    renderCuadreDetailRows(rows);
    saveCuadreDraftLocal();
  });
}
initCuadreCajaDraft();








