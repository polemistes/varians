import { mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AlignableText from '@/components/AlignableText.vue';
import type { TextEditOp } from '@/lib/transcriptionEdit';
import type { Assignment } from '@/types/models';

/**
 * The editable surface, checked where only a DOM can answer: which side of an
 * assignment's MARKER the caret stands on. A marker holds no text, so both
 * sides of it measure to the same offset and only the document order tells
 * them apart — everything that ever went wrong at a marker went wrong for
 * want of that. See .ai/rules/pages-transcriptions.md.
 */
const assignment = (
    id: number,
    start: number,
    end: number,
    label: string,
): Assignment => ({
    id,
    transcription_layer_id: 1,
    canonical_passage_id: id,
    start_offset: start,
    end_offset: end,
    part: 1,
    needs_review: false,
    canonical_passage: {
        id,
        work_id: 1,
        address: { line: id },
        sort_key: String(id),
        label,
    },
});

/** "alpha gamma" — two assignments with a space, so a marker stands at 6. */
const surface = (
    text = 'alpha gamma',
    assignments = [assignment(1, 0, 5, '1'), assignment(2, 6, 11, '2')],
) =>
    mount(AlignableText, {
        props: { text, assignments, editable: true },
        attachTo: document.body,
    });

const root = (wrapper: VueWrapper) => wrapper.element as HTMLElement;

/** Every text node the writer can put a caret in, in order. */
const textNodes = (wrapper: VueWrapper): Text[] => {
    const walker = document.createTreeWalker(
        root(wrapper),
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: (node) =>
                node.parentElement?.closest('[data-non-text]')
                    ? NodeFilter.FILTER_REJECT
                    : NodeFilter.FILTER_ACCEPT,
        },
    );
    const nodes: Text[] = [];
    let node = walker.nextNode();

    while (node) {
        nodes.push(node as Text);
        node = walker.nextNode();
    }

    return nodes;
};

const nodeHolding = (wrapper: VueWrapper, data: string): Text => {
    const node = textNodes(wrapper).find(
        (candidate) => candidate.data === data,
    );

    if (!node) {
        throw new Error(`no text node holding ${JSON.stringify(data)}`);
    }

    return node;
};

const chipAt = (wrapper: VueWrapper, offset: number): HTMLElement => {
    const chip = root(wrapper).querySelector(
        `[data-marker-offset="${offset}"]`,
    );

    if (!(chip instanceof HTMLElement)) {
        throw new Error(`no marker at ${offset}`);
    }

    return chip;
};

/** Put the caret in the text and type one character there. */
const typeAt = (
    wrapper: VueWrapper,
    node: Text,
    offset: number,
    data = 'X',
    inputType = 'insertText',
) => {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const event = new InputEvent('beforeinput', {
        inputType,
        data,
        bubbles: true,
        cancelable: true,
    });
    // jsdom carries neither of these on an InputEvent it constructs.
    Object.defineProperty(event, 'getTargetRanges', {
        value: () => [
            {
                startContainer: node,
                startOffset: offset,
                endContainer: node,
                endOffset: offset,
            },
        ],
    });
    Object.defineProperty(event, 'dataTransfer', {
        value: { getData: () => data },
    });
    root(wrapper).dispatchEvent(event);
};

const editFrom = (wrapper: VueWrapper): TextEditOp => {
    const edits = wrapper.emitted('edit');

    if (!edits?.length) {
        throw new Error('the surface reported no edit');
    }

    return edits[0][0] as TextEditOp;
};

describe('the side of a marker an edit was made on', () => {
    it('is BEFORE when the caret stands against the text that precedes it', () => {
        const wrapper = surface();
        // The space between the assignments: its end is the marker's near side.
        typeAt(wrapper, nodeHolding(wrapper, ' '), 1);

        expect(editFrom(wrapper)).toMatchObject({
            start: 6,
            end: 6,
            text: 'X',
            side: 'before',
        });
        wrapper.unmount();
    });

    it('is AFTER when it stands against the assignment’s own first word', () => {
        const wrapper = surface();
        typeAt(wrapper, nodeHolding(wrapper, 'gamma'), 0);

        expect(editFrom(wrapper)).toMatchObject({
            start: 6,
            end: 6,
            text: 'X',
            side: 'after',
        });
        wrapper.unmount();
    });

    it('survives an empty text node left beside the marker', () => {
        // The browser parks these in an editable surface of its own accord
        // (beside a chip, at the end of the surface) and they come and go as
        // the DOM is patched. A walk that stopped at one reported no marker
        // at all, so the near side silently began writing into the assignment
        // the marker announces — the real defect, and the reason it seemed
        // to come and go with no systematic occasion.
        const wrapper = surface();
        const chip = chipAt(wrapper, 6);
        chip.parentNode?.insertBefore(document.createTextNode(''), chip);

        typeAt(wrapper, nodeHolding(wrapper, ' '), 1);

        expect(editFrom(wrapper).side).toBe('before');
        wrapper.unmount();
    });

    it('is not reported where no marker stands', () => {
        const wrapper = surface();
        typeAt(wrapper, nodeHolding(wrapper, 'alpha'), 3);

        expect(editFrom(wrapper).side ?? null).toBeNull();
        wrapper.unmount();
    });
});

describe('how an edit arrived', () => {
    it('marks a paste as imported, so it comes in unassigned', () => {
        const wrapper = surface();
        typeAt(
            wrapper,
            nodeHolding(wrapper, 'alpha'),
            3,
            'words',
            'insertFromPaste',
        );

        expect(editFrom(wrapper).imported).toBe(true);
        wrapper.unmount();
    });

    it('does not mark typing', () => {
        const wrapper = surface();
        typeAt(wrapper, nodeHolding(wrapper, 'alpha'), 3);

        expect(editFrom(wrapper).imported ?? false).toBe(false);
        wrapper.unmount();
    });
});
