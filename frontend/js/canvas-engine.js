import { supabase } from './supabaseClient.js';
import { api } from './api.js';

const CARD_WIDTH = 220;
const HEADER_HEIGHT = 38;
const ROW_HEIGHT = 40;

const TYPE_LABELS = { sub_niche: 'Sub-Niche', audience: 'Audience', monetization: 'Monetization' };
const BRANCHABLE_TYPES = ['sub_niche', 'audience', 'monetization'];

const viewport = document.getElementById('viewport');
const world = document.getElementById('world');
const edgesLayer = document.getElementById('edgesLayer');
const groupsLayer = document.getElementById('groupsLayer');
const popover = document.getElementById('popover');
const toast = document.getElementById('toast');
const lockBadge = document.getElementById('lockBadge');
const stuckBtn = document.getElementById('stuckBtn');

const state = {
  blueprintId: null,
  locked: false,
  groups: [],
  options: [],
  edges: [],
  pan: { x: 80, y: 80 },
  zoom: 1,
};

let insightLog = []; // { groupId, text, expiresAt }
let isPanning = false;
let panStart = { x: 0, y: 0 };
let panOrigin = { x: 0, y: 0 };
let draggingGroup = null;
let dragStart = { x: 0, y: 0 };
let dragOrigin = { x: 0, y: 0 };

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3200);
}

function setBusy(isBusy) {
  document.body.style.cursor = isBusy ? 'wait' : '';
  stuckBtn.disabled = isBusy || state.locked;
}

// ---------- graph lookups ----------

function optionsForGroup(groupId) {
  return state.options.filter((o) => o.group_id === groupId);
}

function childGroupsForOption(optionId) {
  const groupIds = state.edges.filter((e) => e.from_option_id === optionId).map((e) => e.to_group_id);
  return state.groups.filter((g) => groupIds.includes(g.id));
}

function isGroupFrozen(group) {
  if (!group.parent_option_id) return false;
  const parentOption = state.options.find((o) => o.id === group.parent_option_id);
  if (!parentOption) return false;
  if (parentOption.frozen) return true;
  const parentGroup = state.groups.find((g) => g.id === parentOption.group_id);
  return parentGroup ? isGroupFrozen(parentGroup) : false;
}

function pathFor(x1, y1, x2, y2) {
  const midX = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
}

// ---------- rendering ----------

function render() {
  groupsLayer.innerHTML = '';
  edgesLayer.innerHTML = '';

  state.groups.forEach((group) => {
    const frozenGroup = isGroupFrozen(group);
    const card = document.createElement('div');
    card.className = `group-card${frozenGroup ? ' frozen' : ''}`;
    card.style.left = `${group.position_x ?? 80}px`;
    card.style.top = `${group.position_y ?? 80}px`;

    const header = document.createElement('div');
    header.className = `group-header type-${group.type}`;
    const titleSpan = document.createElement('span');
    titleSpan.textContent = group.label;
    header.appendChild(titleSpan);

    if (!frozenGroup) {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'retry-btn';
      retryBtn.textContent = '↻';
      retryBtn.disabled = state.locked;
      retryBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        retryGroup(group, retryBtn);
      });
      header.appendChild(retryBtn);
    }
    attachGroupDrag(header, group);
    card.appendChild(header);

    optionsForGroup(group.id).forEach((option) => {
      const hasChildren = childGroupsForOption(option.id).length > 0;
      const row = document.createElement('div');
      row.className = `option-row${option.frozen ? ' frozen' : ''}${hasChildren ? ' has-children' : ''}`;

      const dot = document.createElement('span');
      dot.className = 'dot';
      attachOptionDotClick(dot, option);

      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = option.label;

      row.appendChild(dot);
      row.appendChild(label);

      if (!frozenGroup && !state.locked) {
        const branchBtn = document.createElement('button');
        branchBtn.className = 'branch-btn';
        branchBtn.textContent = '+';
        branchBtn.title = 'Branch a new group from this option';
        branchBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openBranchPopover(branchBtn, option);
        });
        row.appendChild(branchBtn);
      }

      card.appendChild(row);
    });

    if (!frozenGroup && !state.locked) {
      const customRow = document.createElement('div');
      customRow.className = 'custom-row';
      const input = document.createElement('input');
      input.placeholder = '+ Type your own, press Enter';
      attachCustomInsert(input, group);
      customRow.appendChild(input);
      card.appendChild(customRow);
    }

    groupsLayer.appendChild(card);
  });

  // edges
  state.edges.forEach((edge) => {
    const fromOption = state.options.find((o) => o.id === edge.from_option_id);
    const toGroup = state.groups.find((g) => g.id === edge.to_group_id);
    if (!fromOption || !toGroup) return;
    const fromGroup = state.groups.find((g) => g.id === fromOption.group_id);
    if (!fromGroup) return;

    const rowIndex = optionsForGroup(fromGroup.id).findIndex((o) => o.id === fromOption.id);
    const x1 = (fromGroup.position_x ?? 80) + CARD_WIDTH;
    const y1 = (fromGroup.position_y ?? 80) + HEADER_HEIGHT + rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
    const x2 = toGroup.position_x ?? 80;
    const y2 = (toGroup.position_y ?? 80) + HEADER_HEIGHT / 2;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathFor(x1, y1, x2, y2));
    if (fromOption.frozen) path.classList.add('frozen-edge');
    edgesLayer.appendChild(path);
  });

  // insight bubbles
  insightLog = insightLog.filter((i) => i.expiresAt > Date.now());
  insightLog.forEach((entry) => {
    const group = state.groups.find((g) => g.id === entry.groupId);
    if (!group) return;
    const bubble = document.createElement('div');
    bubble.className = 'insight-bubble';
    bubble.style.left = `${group.position_x ?? 80}px`;
    bubble.style.top = `${(group.position_y ?? 80) - 70}px`;
    bubble.textContent = entry.text;
    const dismiss = document.createElement('span');
    dismiss.className = 'dismiss';
    dismiss.textContent = '✕';
    dismiss.addEventListener('click', () => {
      insightLog = insightLog.filter((x) => x !== entry);
      render();
    });
    bubble.appendChild(dismiss);
    groupsLayer.appendChild(bubble);
  });
}

function applyTransform() {
  world.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
}

// ---------- actions ----------

async function retryGroup(group, btnEl) {
  if (state.locked) return;
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = '…';
  }
  try {
    const result = await api.retryGroup(state.blueprintId, group.id);
    state.options = state.options.filter((o) => o.group_id !== group.id).concat(result.options);
    render();
  } catch (err) {
    showToast(err.message || 'Retry failed', true);
  } finally {
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.textContent = '↻';
    }
  }
}

async function freezeSiblingBranches(activeOption) {
  const siblings = optionsForGroup(activeOption.group_id).filter(
    (o) => o.id !== activeOption.id && !o.frozen
  );
  for (const sibling of siblings) {
    if (childGroupsForOption(sibling.id).length > 0) {
      try {
        await api.freezeOption(state.blueprintId, sibling.id);
        sibling.frozen = true;
      } catch {
        /* non-fatal — worst case the old branch just isn't grayed out yet */
      }
    }
  }
}

async function branchFrom(option, groupType, mode = 'generate') {
  if (state.locked) return;
  setBusy(true);
  try {
    await freezeSiblingBranches(option);
    const fromGroup = state.groups.find((g) => g.id === option.group_id);
    const siblingChildCount = childGroupsForOption(option.id).length;
    const positionX = (fromGroup?.position_x ?? 80) + CARD_WIDTH + 90;
    const positionY = (fromGroup?.position_y ?? 80) + siblingChildCount * 170;

    const result = await api.createGroup(state.blueprintId, {
      groupType,
      parentOptionId: option.id,
      mode,
      positionX,
      positionY,
    });

    state.groups.push(result.group);
    state.options.push(...result.options);
    state.edges.push(result.edge);
    if (result.insight) {
      insightLog.push({ groupId: result.group.id, text: result.insight, expiresAt: Date.now() + 12000 });
    }
    render();
  } catch (err) {
    showToast(err.message || 'Could not branch this path', true);
  } finally {
    setBusy(false);
  }
}

stuckBtn.addEventListener('click', async () => {
  if (state.locked) {
    showToast('Upgrade to Pro to keep building this blueprint');
    return;
  }
  const candidates = state.options.filter((o) => !o.frozen && childGroupsForOption(o.id).length === 0);
  if (!candidates.length) {
    showToast('Nothing left to branch — try Retry or Custom on a group');
    return;
  }
  const leaf = candidates[candidates.length - 1];
  const usedTypes = state.groups.filter((g) => g.parent_option_id === leaf.id).map((g) => g.type);
  const choices = BRANCHABLE_TYPES.filter((t) => !usedTypes.includes(t));
  if (!choices.length) {
    showToast('This path has explored every branch type already');
    return;
  }
  const type = choices[Math.floor(Math.random() * choices.length)];
  await branchFrom(leaf, type, 'random');
});

// ---------- popover (choose branch type) ----------

function openBranchPopover(anchorEl, option) {
  const existingTypes = childGroupsForOption(option.id).map((g) => g.type);
  const choices = BRANCHABLE_TYPES.filter((t) => !existingTypes.includes(t));
  if (!choices.length) {
    showToast('Every branch type has already been explored from here');
    return;
  }

  popover.innerHTML = '';
  choices.forEach((type) => {
    const btn = document.createElement('button');
    btn.textContent = TYPE_LABELS[type];
    btn.addEventListener('click', () => {
      hidePopover();
      branchFrom(option, type, 'generate');
    });
    popover.appendChild(btn);
  });

  const rect = anchorEl.getBoundingClientRect();
  popover.style.left = `${rect.right + 8}px`;
  popover.style.top = `${rect.top}px`;
  popover.hidden = false;
}

function hidePopover() {
  popover.hidden = true;
}

document.addEventListener('click', (e) => {
  if (!popover.hidden && !e.target.closest('.popover') && !e.target.closest('.branch-btn')) hidePopover();
});

// ---------- custom insert ----------

function attachCustomInsert(inputEl, group) {
  inputEl.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const label = inputEl.value.trim();
    if (!label) return;
    inputEl.disabled = true;
    try {
      const { option } = await api.addCustomOption(state.blueprintId, group.id, label);
      state.options.push(option);
      render();
    } catch (err) {
      showToast(err.message || 'Could not add option', true);
      inputEl.disabled = false;
    }
  });
}

// ---------- freeze / unfreeze via the dot ----------

function attachOptionDotClick(dotEl, option) {
  dotEl.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!option.frozen || state.locked) return;
    try {
      await freezeSiblingBranches(option);
      await api.unfreezeOption(state.blueprintId, option.id);
      option.frozen = false;
      render();
    } catch (err) {
      showToast(err.message || 'Could not switch branches', true);
    }
  });
}

// ---------- drag a group ----------

function attachGroupDrag(headerEl, group) {
  headerEl.addEventListener('mousedown', (e) => {
    if (e.target.closest('.retry-btn') || state.locked) return;
    e.stopPropagation();
    draggingGroup = group;
    dragStart = { x: e.clientX, y: e.clientY };
    dragOrigin = { x: group.position_x ?? 80, y: group.position_y ?? 80 };
  });
}

// ---------- pan / zoom ----------

viewport.addEventListener('mousedown', (e) => {
  if (e.target.closest('.group-card') || e.target.closest('.zoom-controls') || e.target.closest('.popover')) return;
  isPanning = true;
  viewport.classList.add('panning');
  panStart = { x: e.clientX, y: e.clientY };
  panOrigin = { ...state.pan };
});

window.addEventListener('mousemove', (e) => {
  if (isPanning) {
    state.pan.x = panOrigin.x + (e.clientX - panStart.x);
    state.pan.y = panOrigin.y + (e.clientY - panStart.y);
    applyTransform();
  } else if (draggingGroup) {
    const dx = (e.clientX - dragStart.x) / state.zoom;
    const dy = (e.clientY - dragStart.y) / state.zoom;
    draggingGroup.position_x = dragOrigin.x + dx;
    draggingGroup.position_y = dragOrigin.y + dy;
    render();
  }
});

window.addEventListener('mouseup', () => {
  if (isPanning) {
    isPanning = false;
    viewport.classList.remove('panning');
  }
  if (draggingGroup) {
    api
      .updateGroupPosition(state.blueprintId, draggingGroup.id, draggingGroup.position_x, draggingGroup.position_y)
      .catch(() => {});
    draggingGroup = null;
  }
});

viewport.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const worldX = (mouseX - state.pan.x) / state.zoom;
    const worldY = (mouseY - state.pan.y) / state.zoom;

    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    const newZoom = Math.min(2, Math.max(0.4, state.zoom + delta));

    state.pan.x = mouseX - worldX * newZoom;
    state.pan.y = mouseY - worldY * newZoom;
    state.zoom = newZoom;
    applyTransform();
  },
  { passive: false }
);

document.getElementById('zoomIn').addEventListener('click', () => {
  state.zoom = Math.min(2, state.zoom + 0.15);
  applyTransform();
});
document.getElementById('zoomOut').addEventListener('click', () => {
  state.zoom = Math.max(0.4, state.zoom - 0.15);
  applyTransform();
});
document.getElementById('zoomReset').addEventListener('click', () => {
  state.zoom = 1;
  state.pan = { x: 80, y: 80 };
  applyTransform();
});

// ---------- init ----------

async function init() {
  const params = new URLSearchParams(window.location.search);
  state.blueprintId = params.get('id');
  if (!state.blueprintId) {
    window.location.href = 'dashboard.html';
    return;
  }

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session) {
    window.location.href = 'auth.html';
    return;
  }

  try {
    const result = await api.getBlueprint(state.blueprintId);
    state.groups = result.groups;
    state.options = result.options;
    state.edges = result.edges;
    state.locked = result.locked;

    lockBadge.hidden = !state.locked;
    stuckBtn.disabled = state.locked;

    if (state.groups.length && !optionsForGroup(state.groups[0].id).length && !state.locked) {
      // The root "Niches" group is seeded empty on creation — fill it now.
      await retryGroup(state.groups[0]);
    }

    applyTransform();
    render();
  } catch (err) {
    showToast(err.message || 'Could not load this blueprint', true);
  }
}

init();
