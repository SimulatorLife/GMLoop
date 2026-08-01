import { LitElement } from "lit";

/**
 * Lit element base class that renders into light DOM so standalone stylesheet assets can style all UI surfaces.
 */
export abstract class LightDomLitElement extends LitElement {
    protected createRenderRoot(): HTMLElement {
        return this;
    }
}
