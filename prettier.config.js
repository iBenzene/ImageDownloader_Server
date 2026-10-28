module.exports = {
    arrowParens: 'avoid',
    overrides: [
        {
            files: ['*.css', '*.scss', '*.less'],
            options: {
                singleQuote: false
            }
        }
    ],
    plugins: ['@prettier/plugin-pug'],
    singleQuote: true,
    tabWidth: 4,
    trailingComma: 'none'
};
