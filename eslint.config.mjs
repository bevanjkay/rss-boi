import antfu from "@antfu/eslint-config";

export default antfu({
  react: true,
  stylistic: {
    indent: 2,
    jsx: true,
    quotes: "double",
    semi: true,
  },
  ignores: [
    "**/dist/**",
    "**/node_modules/**",
    "**/.vite/**",
  ],
}, {
  rules: {
    "node/prefer-global/process": "off",
  },
}, {
  files: ["apps/web/src/components/ui/*.tsx"],
  rules: {
    "react-refresh/only-export-components": "off",
  },
}, {
  files: ["apps/web/src/app/App.tsx"],
  rules: {
    "react-dom/no-dangerously-set-innerhtml": "off",
  },
});
