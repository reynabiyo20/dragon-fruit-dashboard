import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SimilarEntryHint } from './SimilarEntryHint';

const OPTIONS = ['Thai White', 'Palora Yellow', 'White Ecuador'];

describe('SimilarEntryHint', () => {
  it('shows an "already exists" notice on an exact match (case-insensitive)', () => {
    render(<SimilarEntryHint value="thai white" options={OPTIONS} noun="variety" />);
    expect(screen.getByText(/already exists as a variety/i)).toBeInTheDocument();
  });

  it('shows similar suggestions for a partial match', () => {
    render(<SimilarEntryHint value="white" options={OPTIONS} noun="variety" />);
    expect(screen.getByText(/similar existing varietys/i)).toBeInTheDocument();
    // Both "Thai White" and "White Ecuador" contain "white"
    expect(screen.getByRole('button', { name: 'Thai White' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'White Ecuador' })).toBeInTheDocument();
  });

  it('calls onPick when a suggestion is clicked', () => {
    const onPick = vi.fn();
    render(<SimilarEntryHint value="white" options={OPTIONS} noun="variety" onPick={onPick} />);
    fireEvent.click(screen.getByRole('button', { name: 'White Ecuador' }));
    expect(onPick).toHaveBeenCalledWith('White Ecuador');
  });

  it('renders nothing for a brand-new value with no matches', () => {
    const { container } = render(<SimilarEntryHint value="Moroccan Red" options={OPTIONS} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the value already equals an option exactly (a selection)', () => {
    // e.g. the user picked "Thai White" from the dropdown — nothing to advise.
    const { container } = render(<SimilarEntryHint value="Thai White" options={OPTIONS} noun="variety" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for values under 2 chars', () => {
    const { container } = render(<SimilarEntryHint value="w" options={OPTIONS} />);
    expect(container).toBeEmptyDOMElement();
  });
});
