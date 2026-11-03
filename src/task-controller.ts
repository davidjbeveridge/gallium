import { readPublicTask } from './public-read.ts';
import { OperatorError } from './contracts.ts';
import type { Inputs, Recipe } from './contracts.ts';
import type { Engine } from './engine.ts';
import { validateId, validateInput } from './config.ts';
import { systemOne } from './navigators.ts';

export interface TaskRequest {
  operationId: string;
  goal: string;
  scopeId?: string;
  target?: string;
  input: Inputs;
}

/** One semantic matching request, followed by deterministic route selection and the existing execution loop. */
export async function runTask(engine: Engine, task: TaskRequest, signal = new AbortController().signal) {
  validateId(task.operationId);

  if (typeof task.goal !== 'string' || !task.goal.trim() || task.goal.length > 4000)
    throw new OperatorError('INPUT', 'Supply a bounded task goal.');
  if (task.target) {
    if (task.scopeId || Object.keys(task.input ?? {}).length) throw new OperatorError('INPUT','Public tasks accept a goal and target without account inputs.');
    return readPublicTask(engine, { operationId:task.operationId,goal:task.goal,target:task.target }, signal);
  }
  validateId(task.scopeId);
  if (engine.journal.db.prepare('SELECT id FROM public_tasks WHERE id=?').get(task.operationId))
    throw new OperatorError('OPERATION_CONFLICT','This ID belongs to a public read task.');

  const scope = engine.config.scopes.find(scope => scope.id === task.scopeId);
  if (!scope) throw new OperatorError('UNKNOWN_SCOPE', 'Unknown task scope.');
  if (engine.journal.control(scope.id).owner === 'human')
    return { code: 'PAUSED', scopeId: scope.id };
  const epoch = engine.journal.control(scope.id).epoch;
  const fingerprint = engine.journal.fingerprint(task);
  const previous = engine.journal.db.prepare('SELECT fingerprint, recipe FROM task_routes WHERE id=?').get(task.operationId) as
    { fingerprint: string; recipe: string } | undefined;
  if (previous && previous.fingerprint !== fingerprint)
    throw new OperatorError('OPERATION_CONFLICT', 'The task ID is already bound to different inputs.');
  let recipe = previous?.recipe;
  if (!recipe) {
    const candidates = engine.config.recipes.filter(recipe => {
      if (recipe.scopeId !== scope.id) return false;
      try { validateInput(recipe, task.input); return true; } catch { return false; }
    });
    if (candidates.length > 64) throw new OperatorError('ROUTE_LIMIT','Narrow the configured task scope to at most 64 procedures.');
    if (!candidates.length) return { code: 'CAPABILITY_REQUIRED', scopeId: scope.id };
    const questions = Object.fromEntries(candidates.map((candidate, index) => {
      const goal = candidate.http
        ? { field: candidate.http.goalPath, inputKey: candidate.http.expectedInputKey, expected: candidate.http.expected }
        : candidate.browser?.goal;
      const expected = goal?.inputKey ? task.input[goal.inputKey] : goal && ('expected' in goal ? goal.expected : 'text' in goal ? goal.text : undefined);
      return ['fit_' + index, {
        type: 'noul',
        instructions: {
          question: 'Does this procedure accomplish task.goal using task.input?',
          procedure: {
            description: candidate.description,
            inputs: candidate.inputs,
            target: { origin: scope.origin, account: scope.account },
            result: { field: candidate.http?.goalPath, expected, effect: candidate.http?.effect },
          },
        },
        criteria: {
          true: 'The procedure implements the requested outcome with the supplied inputs.',
          false: 'The requested outcome requires a different operation or additional unsupported work.',
        },
      }];
    }));
    const provider = engine.config.taskRouter;
    if (!provider) throw new OperatorError('ROUTER_REQUIRED', 'Configure the internal System One router.');
    const started = performance.now();
    const response = await systemOne(provider, { model: provider.model ?? 'jev-latest',
      state: { task: { goal: task.goal, input: task.input } }, questions }, signal);
    engine.journal.db.prepare('INSERT INTO model_usage(model,cost,elapsed_ms,created_at) VALUES(?,?,?,?)')
      .run(typeof response.model === 'string' ? response.model : 'unknown',
        typeof response.usage?.cost === 'number' ? response.usage.cost : null, Math.round(performance.now()-started), Date.now());
    const eligible = candidates.filter((_, index) => {
      const answer = response.answers?.['fit_' + index];
      if (answer?.type !== 'noul' || typeof answer.noul !== 'number' || !Number.isFinite(answer.noul)
        || answer.noul < 0 || answer.noul > 1) throw new OperatorError('NAVIGATOR_RESPONSE_INVALID', 'Invalid route applicability.');
      return answer.noul >= 0.7;
    });
    if (!eligible.length) return { code: 'CAPABILITY_UNCERTAIN', scopeId: scope.id };
    const rank: Record<Recipe['adapter'], number> = { fixture: 0, http: 1, 'browser-request': 2, playwriter: 3 };
    eligible.sort((a, b) => rank[a.adapter] - rank[b.adapter] || a.id.localeCompare(b.id));
    recipe = engine.journal.transaction(() => {
      engine.journal.db.prepare('INSERT OR IGNORE INTO task_routes(id,fingerprint,recipe) VALUES(?,?,?)')
        .run(task.operationId, fingerprint, eligible[0].id);
      const selected = engine.journal.db.prepare('SELECT fingerprint,recipe FROM task_routes WHERE id=?')
        .get(task.operationId) as { fingerprint: string; recipe: string };
      if (selected.fingerprint !== fingerprint) throw new OperatorError('OPERATION_CONFLICT', 'Concurrent task identity mismatch.');
      return selected.recipe;
    });
  }
  if (engine.journal.control(scope.id).epoch !== epoch) return { code: 'CONTROL_REVOKED', scopeId: scope.id };
  return { ...await engine.act({ operationId: task.operationId, recipe, input: task.input }, signal), route: recipe };
}
