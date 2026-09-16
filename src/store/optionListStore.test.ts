import { describe, it, expect } from 'vitest';
import { createOptionListStore } from './optionListStore';

describe('createOptionListStore — alphabetical sorting', () => {
  it('seeds values in alphabetical order regardless of seed order', () => {
    const useStore = createOptionListStore('test-seed-sort', ['sack', 'bag', 'Kg', 'box']);
    expect(useStore.getState().values).toEqual(['bag', 'box', 'Kg', 'sack']);
  });

  it('keeps values sorted after add()', () => {
    const useStore = createOptionListStore('test-add-sort', ['bag', 'sack']);
    useStore.getState().add('crate');
    expect(useStore.getState().values).toEqual(['bag', 'crate', 'sack']);
  });

  it('is idempotent (case-insensitive) on add', () => {
    const useStore = createOptionListStore('test-add-dedupe', ['Bag']);
    useStore.getState().add('  bag ');
    expect(useStore.getState().values).toEqual(['Bag']);
  });

  it('options() returns sorted {value,label}', () => {
    const useStore = createOptionListStore('test-options-sort', ['sack', 'bag']);
    expect(useStore.getState().options().map((o) => o.value)).toEqual(['bag', 'sack']);
  });

  it('re-sorts after a rename', () => {
    const useStore = createOptionListStore('test-rename-sort', ['apple', 'cherry']);
    useStore.getState().rename('apple', 'zebra'); // apple -> zebra should move to end
    expect(useStore.getState().values).toEqual(['cherry', 'zebra']);
  });
});
