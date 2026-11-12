import { createSharedExecutors } from './executors-shared.js';
import { createDomainExecutors } from './executors-domains.js';

export function createExecutors() {
  return { ...createSharedExecutors(), ...createDomainExecutors() };
}

export function listExecutorNames() {
  return Object.keys(createExecutors()).sort();
}
