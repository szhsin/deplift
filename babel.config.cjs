module.exports = {
  targets: "defaults",
  assumptions: {
    constantReexports: true,
    ignoreFunctionLength: true,
    ignoreToPrimitiveHint: true,
    iterableIsArray: true,
    noDocumentAll: true,
    noIncompleteNsImportDetection: true,
    noNewArrows: true,
    objectRestNoSymbols: true,
    pureGetters: true,
    setComputedProperties: true,
    setSpreadProperties: true,
    skipForOfIteratorClosing: true,
  },
  presets: [
    [
      "@babel/preset-env",
      {
        bugfixes: true,
        include: [
          "@babel/plugin-transform-nullish-coalescing-operator",
          "@babel/plugin-transform-optional-catch-binding",
        ],
      },
    ],
    ["@babel/preset-typescript", { allExtensions: true }],
  ],
};
