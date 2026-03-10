/**
 * Teste do parser ATIVAR_TESTE
 * Valida a funcao parseAtivarTesteCommand
 */

const { parseAtivarTesteCommand } = require('./parser');

console.log('\n=== TESTE DO PARSER ATIVAR_TESTE ===\n');

// Casos de teste
const testCases = [
    // Casos validos
    { input: 'ATIVAR_TESTE 123456 654321', expected: { success: true, login: '123456', senha: '654321' } },
    { input: 'ativar_teste login senha', expected: { success: true, login: 'login', senha: 'senha' } },
    { input: 'ATIVAR_TESTE   abc123   xyz789', expected: { success: true, login: 'abc123', senha: 'xyz789' } },
    { input: '  ATIVAR_TESTE user pass  ', expected: { success: true, login: 'user', senha: 'pass' } },
    { input: 'Ativar_Teste MeuLogin MinhaSenha', expected: { success: true, login: 'MeuLogin', senha: 'MinhaSenha' } },

    // Casos invalidos
    { input: 'ATIVAR_TESTE', expected: { success: false } },
    { input: 'ATIVAR_TESTE apenas_um', expected: { success: false } },
    { input: 'teste iptv cliente ABC123', expected: { success: false } },
    { input: '', expected: { success: false } },
    { input: null, expected: { success: false } },
    { input: 'ATIVAR TESTE login senha', expected: { success: false } }, // sem underscore
];

let passed = 0;
let failed = 0;

testCases.forEach((test, index) => {
    const result = parseAtivarTesteCommand(test.input);
    const isSuccess = result.success === test.expected.success;
    const isLoginCorrect = !test.expected.login || result.login === test.expected.login;
    const isSenhaCorrect = !test.expected.senha || result.senha === test.expected.senha;

    const ok = isSuccess && isLoginCorrect && isSenhaCorrect;

    if (ok) {
        console.log(`✅ Teste ${index + 1}: OK`);
        console.log(`   Input: "${test.input}"`);
        console.log(`   Result: success=${result.success}, login=${result.login}, senha=${result.senha}\n`);
        passed++;
    } else {
        console.log(`❌ Teste ${index + 1}: FALHOU`);
        console.log(`   Input: "${test.input}"`);
        console.log(`   Expected: success=${test.expected.success}, login=${test.expected.login}, senha=${test.expected.senha}`);
        console.log(`   Got: success=${result.success}, login=${result.login}, senha=${result.senha}\n`);
        failed++;
    }
});

console.log('=====================================');
console.log(`Total: ${passed + failed} testes`);
console.log(`✅ Passou: ${passed}`);
console.log(`❌ Falhou: ${failed}`);
console.log('=====================================\n');

process.exit(failed > 0 ? 1 : 0);
