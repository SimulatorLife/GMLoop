import { parseHTML } from "linkedom";
import type { Element } from "linkedom/types/interface/element.js";

/**
 * Parse manual HTML into a traversable document.
 *
 * @param {string} html
 * @returns {Document}
 */
export function parseManualDocument(html: string): Document {
    return parseHTML(html).document;
}

/**
 * Collect direct child elements from a parent element.
 *
 * @param {Element | null | undefined} element
 * @param {string | undefined} selector
 * @returns {Array<Element>}
 */
export function getDirectElementChildren(element: Element | null | undefined, selector?: string): Array<Element> {
    const predicate = selector ? (child: Element) => child.matches?.(selector) === true : () => true;
    return Array.from(element?.children ?? []).filter((child) => predicate(child));
}

/**
 * Replace line-break elements with newline text nodes to preserve semantic text
 * splitting in manual table cells.
 *
 * @param {Element} element
 * @returns {void}
 */
export function replaceBreakElementsWithNewlines(element: Element): void {
    const document = element.ownerDocument;
    for (const breakElement of element.querySelectorAll("br")) {
        breakElement.parentNode?.replaceChild(document.createTextNode("\n"), breakElement);
    }
}
