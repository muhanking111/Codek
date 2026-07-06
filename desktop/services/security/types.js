/**
 * @typedef {'user' | 'agent'} IpcSource
 *   user  — operation initiated by an explicit user action in the UI.
 *   agent — operation initiated by an AI/agent or extension on the user's behalf.
 *
 * @typedef {'low' | 'medium' | 'high'} IpcRisk
 *
 * @typedef {Object} IpcRequestMeta
 * @property {IpcSource} [source]   Defaults to 'user' when omitted.
 * @property {IpcRisk}   [risk]     Caller-declared risk hint; the handler is the final authority.
 * @property {string}    [reason]   Short rationale shown in audit logs (e.g. "agent: apply patch").
 *
 * @typedef {Object} GuardOk
 * @property {true} ok
 * @property {string} resolved
 *
 * @typedef {Object} GuardErr
 * @property {false} ok
 * @property {string} code     // 'OUT_OF_ROOT' | 'TRAVERSAL' | 'ABSOLUTE' | 'EMPTY' | 'BLOCKED'
 * @property {string} message
 *
 * @typedef {GuardOk | GuardErr} GuardResult
 */

module.exports = {}
