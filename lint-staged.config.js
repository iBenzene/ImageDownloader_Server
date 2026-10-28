module.exports = {
    '!(*.{js,mjs,cjs,ts,jsx,tsx,vue,json,jsonc,css,scss,less})': [
        'prettier --write --ignore-unknown',
        'prettier --check --ignore-unknown'
    ],
    '*.{css,scss,less}': ['stylelint --fix', 'prettier --write', 'stylelint'],
    '*.{js,mjs,cjs,ts,jsx,tsx,vue,json,jsonc}': [
        'eslint --config eslint.config.js --fix',
        'prettier --write',
        'eslint --config eslint.config.js'
    ]
};
