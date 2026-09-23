/**
 * Build LlmCallMeta from agent run context + ALS fallbacks.
 */

/**
 * @param {object} [context]
 * @param {object} [overrides]
 */
export function usageMetaFromContext(context = {}, overrides = {}) {
  return {
    companyId: context._companyId ?? context.company_id ?? overrides.companyId,
    userId: context._userId ?? context.user_id ?? overrides.userId,
    conversationId:
      context._conversationId
      ?? context.conversation_id
      ?? overrides.conversationId,
    requestId: context._rexRequestId ?? context._requestId ?? overrides.requestId,
    phase: overrides.phase ?? context._usagePhase ?? 'agent',
    agentKey: overrides.agentKey ?? context._agentKey,
  };
}
