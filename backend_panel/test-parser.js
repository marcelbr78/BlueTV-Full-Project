/**
 * Teste do Parser de Mensagens IPTV
 * Execute: node test-parser.js
 */

const { isXtreamResponse, parseXtreamMessage, extractM3uUrl } = require('./parser');

// Mensagem real do painel MEGGA IPTV
const mensagemReal = `47997193147
*Seja bem vindo a MEGGA IPTV*

====================================

*CELULARES, TABLETS, TV BOX e Demais app* ( IOS ou ANDROID )
╭─ 📱
├●   🟢 *Preencha todos os dados corretamente*
├●
├●   📡 Dns/Url: http://megga10.top:80
├●   👤 USUÁRIO: 36228424
├●   🔐 SENHA:  26136519
╰──> *Obs: Caso não entre, veja as DNs extra que se encontra logo a baixo.

====================================

*EXCLUSIVO PARA IPTV SMATERS NA TV LG ou SAMSUNG*
╭─ 📱
├●   🟢 *Preencha todos os dados corretamente*
├●
├●   📡 Dns/Url: http://megga10.top:80
├●   👤 USUÁRIO: 36228424
├●   🔐 SENHA:  26136519
╰──> *Obs: Caso não entre, veja as DNs extra que se encontra logo a baixo.
 
====================================

🗓️ *Vencimento:* 04/02/2026 23:59:59
📶 *Conexões:* 1

🟢 *Link (M3U):* http://megga10.top:80/get.php?username=36228424&password=26136519&type=m3u_plus&output=mpegts
`;

console.log('='.repeat(50));
console.log('TESTE DO PARSER XTREAM');
console.log('='.repeat(50));

// Teste: isXtreamResponse
console.log('\n1️⃣ Verificando se é resposta IPTV...');
const isResponse = isXtreamResponse(mensagemReal);
console.log(`   Resultado: ${isResponse ? '✅ SIM' : '❌ NÃO'}`);

// Teste: parseXtreamMessage
console.log('\n2️⃣ Extraindo credenciais...');
const xtream = parseXtreamMessage(mensagemReal);
console.log(`   Host:     ${xtream.host || '❌ Não encontrado'}`);
console.log(`   Username: ${xtream.username || '❌ Não encontrado'}`);
console.log(`   Password: ${xtream.password || '❌ Não encontrado'}`);
console.log(`   Validade: ${xtream.validade || '❌ Não encontrado'}`);
console.log(`   Sucesso:  ${xtream.success ? '✅ SIM' : '❌ NÃO'}`);

// Teste: extractM3uUrl
console.log('\n3️⃣ Extraindo URL M3U...');
const m3u = extractM3uUrl(mensagemReal);
console.log(`   M3U: ${m3u || '❌ Não encontrado'}`);

// Resumo
console.log('\n' + '='.repeat(50));
console.log('RESUMO DO TESTE');
console.log('='.repeat(50));

const esperado = {
    host: 'http://megga10.top:80',
    username: '36228424',
    password: '26136519'
};

let passed = 0;
let failed = 0;

if (xtream.host === esperado.host) {
    console.log('✅ Host correto');
    passed++;
} else {
    console.log(`❌ Host incorreto: esperado "${esperado.host}", recebido "${xtream.host}"`);
    failed++;
}

if (xtream.username === esperado.username) {
    console.log('✅ Username correto');
    passed++;
} else {
    console.log(`❌ Username incorreto: esperado "${esperado.username}", recebido "${xtream.username}"`);
    failed++;
}

if (xtream.password === esperado.password) {
    console.log('✅ Password correto');
    passed++;
} else {
    console.log(`❌ Password incorreto: esperado "${esperado.password}", recebido "${xtream.password}"`);
    failed++;
}

if (xtream.validade) {
    console.log('✅ Validade extraída');
    passed++;
} else {
    console.log('⚠️ Validade não extraída (opcional)');
}

if (m3u && m3u.includes('get.php')) {
    console.log('✅ M3U URL extraída');
    passed++;
} else {
    console.log('⚠️ M3U URL não extraída (opcional)');
}

console.log('\n' + '='.repeat(50));
console.log(`RESULTADO: ${passed} passou, ${failed} falhou`);
console.log('='.repeat(50));

if (failed === 0) {
    console.log('\n🎉 TODOS OS TESTES PASSARAM!');
    process.exit(0);
} else {
    console.log('\n❌ ALGUNS TESTES FALHARAM');
    process.exit(1);
}
