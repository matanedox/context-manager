/** Agent screen: who this chat can talk to, and the panel that writes them a note. */
/* global ui, vscode, paint, escapeHtml, ROBOT_SVG, handoffDraft */
/* exported renderFlow, sendDelegate */

/** A member to talk to; open sessions also get Focus, which moves the IDE to their chat. */
function targetRow(item, selectedId) {
  const focus =
    item.kind === "session" && item.conversationId
      ? `<button type="button" class="handoff-focus" data-focus-session="${escapeHtml(
          item.conversationId,
        )}" title="Open and focus that chat">Focus</button>`
      : "";
  return `<div class="handoff-row">
    <button type="button" class="handoff-target${
      item.id === selectedId ? " selected" : ""
    }" data-handoff-target="${escapeHtml(item.id)}" aria-pressed="${item.id === selectedId}">
      ${ROBOT_SVG}
      <span class="handoff-copy">
        <span class="handoff-role">${escapeHtml(item.roleLabel)}</span>
        <span class="handoff-detail">${escapeHtml(item.detail)}</span>
      </span>
    </button>${focus}
  </div>`;
}

/**
 * Its own block below the member list: this starts a new helper inside the current chat, it does
 * not hand anything to the member selected above.
 */
function delegateBlock(payload) {
  const options = (payload.roster ?? [])
    .map((item) => `<option value="${escapeHtml(item.role)}">${escapeHtml(item.name ?? item.roleLabel)}</option>`)
    .join("");
  const form = ui.showSubagent
    ? `<p class="hint">This chat starts the subagent and keeps the conversation; it joins the
        list above while it runs.</p>
      <form class="handoff-form subagent-form" id="subagent-form">
        <select name="role" aria-label="Persona for the subagent">
          <option value="">No persona — Cursor picks one</option>
          ${options}
        </select>
        <input type="text" name="text" placeholder="What should the subagent do?" autocomplete="off" required />
        <button type="submit">Start subagent</button>
      </form>`
    : "";
  return `<div class="delegate-block">
    <button type="button" class="ctx-add-btn${
      ui.showSubagent ? " active" : ""
    }" id="toggle-subagent" aria-expanded="${ui.showSubagent}">+ New subagent in this chat</button>
    ${form}
  </div>`;
}

/**
 * The board cannot call the Task tool, so delegating is a note to this chat asking it to spawn
 * the subagent — with a persona to wear, or none, in which case Cursor picks from the context.
 */
function sendDelegate(task, role) {
  const payload = ui.currentPayload;
  const conversationId = (payload?.sessions ?? []).find((item) => item.active)?.conversationId;
  if (!conversationId) return;
  const persona = (payload.roster ?? []).find((item) => item.role === role);
  const label = persona?.name ?? persona?.roleLabel ?? role;
  vscode.postMessage({
    type: "sendHandoff",
    targetKind: "session",
    role: payload.selectedRole,
    conversationId,
    text: role
      ? `Launch a subagent wearing the ${label} persona (role id ${role}, charter under .cursor/personas): ${task}`
      : `Launch the subagent type that best fits this task, given our context so far: ${task}`,
  });
}

/** Who is available lives inside the dropdown: pick a member, then + writes them a note. */
function renderFlow(payload) {
  const flow = document.getElementById("flow");
  const collaborators = payload.collaborators ?? [];
  const count = document.getElementById("flow-count");
  if (count) count.textContent = String(collaborators.length);

  const target = collaborators.find((item) => item.id === ui.handoffTargetId) ?? collaborators[0];
  ui.handoffTargetId = target?.id ?? null;
  const draft = handoffDraft();
  const noteLabel = target?.lastNoteIncoming
    ? `From ${target.roleLabel}`
    : target?.lastNotePending
      ? "Waiting for their next turn"
      : "Last";
  const note = target?.lastNote
    ? `<p class="handoff-last">${escapeHtml(noteLabel)}: ${escapeHtml(target.lastNote)}</p>`
    : "";
  const rows = collaborators.map((item) => targetRow(item, target?.id)).join("");
  const talk = target
    ? `<button type="button" class="flow-add-btn wide" id="toggle-handoff" aria-expanded="${
        ui.showHandoff
      }">+ Message ${escapeHtml(target.roleLabel)}</button>`
    : "";
  const form =
    ui.showHandoff && target
      ? `<form class="handoff-form" id="handoff-form">
        <input type="text" name="text" placeholder="Context for ${escapeHtml(
          target.roleLabel,
        )}…" autocomplete="off" required />
        <button type="submit">Send</button>
      </form>`
      : "";
  const painted = paint(
    flow,
    `<div class="handoff-panel">
      ${
        rows
          ? `<div class="handoff-targets">${rows}</div>`
          : '<p class="empty">No open session or running subagent to pass context to.</p>'
      }
      <div class="handoff-bar">
        ${note || '<span class="hint inline">Nothing passed yet.</span>'}
        ${talk}
      </div>
      ${form}
      ${delegateBlock(payload)}
    </div>`,
  );
  if (!painted) return;
  const input = flow.querySelector('.handoff-form input[name="text"]');
  if (input && draft) input.value = draft;
}
