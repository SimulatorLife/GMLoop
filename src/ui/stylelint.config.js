export default {
    plugins: ["stylelint-declaration-strict-value"],
    rules: {
        "scale-unlimited/declaration-strict-value": [
            [
                "color",
                "background-color",
                "border-color",
                "font-weight",
                "font-size",
                "font-family",
                "line-height",
                "border-radius",
                "box-shadow",
                "/margin/",
                "/padding/",
                "/gap/"
            ],
            {
                ignoreValues: [
                    "0",
                    "none",
                    "inherit",
                    "initial",
                    "unset",
                    "transparent",
                    "currentColor",
                    "auto",
                    "50%",
                    "1px",
                    "inset"
                ],
                ignoreFunctions: false,
                severity: "error",
                message:
                    "Use a --gm-* design token variable instead of a hardcoded value."
            }
        ]
    },
    ignoreFiles: ["**/tokens.css", "**/dist/**"]
};
