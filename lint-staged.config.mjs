export default {
  '*': 'prettier --write --ignore-unknown',
  '{src,assembly}/**/*.ts': 'eslint',
  'src/**/*.html': 'eslint',
};
