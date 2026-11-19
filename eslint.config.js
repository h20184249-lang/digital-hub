import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'node_modules/**/*', '.wrangler/**/*']
  },
  firebaseRulesPlugin.configs['flat/recommended']
];
