export default {
  '*': 'prettier --write --ignore-unknown',
  'src/**/*.{ts,html}': 'eslint',
};
