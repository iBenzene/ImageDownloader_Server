module.exports = {
    extends: ['stylelint-config-standard'],
    ignoreFiles: [
        '**/node_modules/**',
        '**/dist/**',
        '**/coverage/**',
        '**/package-lock.json'
    ],
    overrides: [
        { extends: ['stylelint-config-standard-scss'], files: ['**/*.scss'] },
        { extends: ['stylelint-config-standard-less'], files: ['**/*.less'] }
    ],
    plugins: ['stylelint-order', 'stylelint-prettier'],
    rules: {
        'order/properties-alphabetical-order': true,
        'prettier/prettier': true
    }
};
