const DEFAULT_SCENE_KEY = 'h3_prompt_compile';
const SKILL_NAME = 'h3-prompt-writing';

const LOAD_SKILL_TOOL = Object.freeze({
  type: 'function',
  function: Object.freeze({
    name: 'load_skill',
    description: 'Load an allowlisted project skill before performing the task.',
    parameters: Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: ['skill_name'],
      properties: Object.freeze({
        skill_name: Object.freeze({
          type: 'string',
          enum: [SKILL_NAME],
        }),
      }),
    }),
  }),
});

class H3SkillAgentError extends Error {
  constructor(code, message, details = {}) {
    super(message || code);
    this.name = 'H3SkillAgentError';
    this.code = code;
    this.details = details;
  }
}

function invalid(message, details = {}) {
  return new H3SkillAgentError('H3_SKILL_TOOL_CALL_INVALID', message, details);
}

function getToolCall(message) {
  if (!message || !Array.isArray(message.tool_calls) || message.tool_calls.length === 0) {
    throw new H3SkillAgentError(
      'H3_SKILL_TOOL_CALL_UNSUPPORTED',
      'The configured text model did not return a skill tool call',
    );
  }
  if (message.tool_calls.length !== 1) {
    throw invalid('The skill request must contain exactly one tool call');
  }
  if (message.content != null && String(message.content).trim()) {
    throw invalid('The skill request must not contain a final answer');
  }
  const call = message.tool_calls[0];
  if (!call || call.type !== 'function' || typeof call.id !== 'string' || !call.id.trim()) {
    throw invalid('The skill tool call is missing a valid call ID or function type');
  }
  if (!call.function || call.function.name !== 'load_skill') {
    throw invalid('The model selected an unsupported skill tool');
  }
  if (typeof call.function.arguments !== 'string') {
    throw invalid('The skill tool arguments must be a JSON object');
  }
  let args;
  try {
    args = JSON.parse(call.function.arguments);
  } catch (_) {
    throw invalid('The skill tool arguments are malformed JSON');
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)
    || Object.keys(args).some((key) => key !== 'skill_name')
    || args.skill_name !== SKILL_NAME) {
    throw invalid('The model requested a skill that is not allowlisted');
  }
  return call;
}

function hasToolCalls(message) {
  return Array.isArray(message?.tool_calls) && message.tool_calls.length > 0;
}

function createH3SkillAgent({ createChatCompletion, loadSkillPackage } = {}) {
  if (typeof createChatCompletion !== 'function') {
    throw new Error('H3 skill agent requires createChatCompletion');
  }
  if (typeof loadSkillPackage !== 'function') {
    throw new Error('H3 skill agent requires loadSkillPackage');
  }

  return {
    async run(db, log, { mode, durationSeconds, sourceBundle } = {}) {
      const messages = [
        {
          role: 'system',
          content: [
            'Before performing the H3 prompt conversion, you must call the provided load_skill tool.',
            'After the skill is loaded, return only the final H3 prompt and do not call any more tools.',
          ].join(' '),
        },
        {
          role: 'user',
          content: [
            `Convert the source into a MiniMax H3 ${String(mode || 'T2VA')} prompt for exactly ${Number(durationSeconds) || 5} seconds.`,
            'Use the loaded h3-prompt-writing skill and output only the final prompt.',
            String(sourceBundle || ''),
          ].join('\n\n'),
        },
      ];

      const first = await createChatCompletion(db, log, 'text', messages, {
        scene_key: DEFAULT_SCENE_KEY,
        tools: [LOAD_SKILL_TOOL],
        tool_choice: { type: 'function', function: { name: 'load_skill' } },
        temperature: 0.2,
        max_tokens: 2200,
      });
      const firstMessage = first?.message;
      const toolCall = getToolCall(firstMessage);
      const skillPackage = loadSkillPackage(SKILL_NAME, { mode });
      if (!skillPackage || skillPackage.skillName !== SKILL_NAME
        || typeof skillPackage.sha256 !== 'string' || !Array.isArray(skillPackage.resources)) {
        throw new H3SkillAgentError('SKILL_RESOURCE_INVALID', 'The loaded skill package is invalid');
      }

      const secondMessages = [
        ...messages,
        firstMessage,
        {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: 'load_skill',
          content: JSON.stringify(skillPackage),
        },
      ];
      const second = await createChatCompletion(db, log, 'text', secondMessages, {
        scene_key: DEFAULT_SCENE_KEY,
        tools: [LOAD_SKILL_TOOL],
        tool_choice: 'none',
        temperature: 0.2,
        max_tokens: 2200,
      });
      const finalMessage = second?.message;
      if (hasToolCalls(finalMessage)) {
        throw new H3SkillAgentError(
          'H3_SKILL_TOOL_CALL_REPEATED',
          'The H3 model attempted another skill tool call',
        );
      }
      const prompt = typeof finalMessage?.content === 'string' ? finalMessage.content.trim() : '';
      if (!prompt) {
        throw new H3SkillAgentError('H3_SKILL_FINAL_EMPTY', 'The H3 model returned an empty final prompt');
      }
      return {
        prompt,
        provenance: {
          skillName: skillPackage.skillName,
          skillSha256: skillPackage.sha256,
          skillResources: skillPackage.resources.map((resource) => resource.name),
          toolCallId: toolCall.id,
          model: second?.model || first?.model || null,
          configId: second?.configId ?? first?.configId ?? null,
        },
      };
    },
  };
}

module.exports = {
  DEFAULT_SCENE_KEY,
  LOAD_SKILL_TOOL,
  H3SkillAgentError,
  createH3SkillAgent,
};
