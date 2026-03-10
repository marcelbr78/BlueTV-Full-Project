/**
 * Teste do webhook Evolution com comando ATIVAR_TESTE
 * Simula o envio de uma mensagem INBOUND para o webhook
 */

const http = require('http');

// Configuracao
const BACKEND_HOST = 'localhost';
const BACKEND_PORT = 3000;

/**
 * Envia uma requisicao POST para o webhook
 */
function sendWebhook(payload, description) {
    return new Promise((resolve, reject) => {
        console.log(`\n📤 Enviando: ${description}`);
        console.log('Payload:', JSON.stringify(payload, null, 2));

        const data = JSON.stringify(payload);

        const options = {
            hostname: BACKEND_HOST,
            port: BACKEND_PORT,
            path: '/webhook/evolution',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                console.log(`📥 Status: ${res.statusCode}`);
                console.log(`📥 Resposta:`, body);
                resolve({ status: res.statusCode, body: JSON.parse(body) });
            });
        });

        req.on('error', (e) => {
            console.error(`❌ Erro:`, e.message);
            reject(e);
        });

        req.write(data);
        req.end();
    });
}

async function runTests() {
    console.log('='.repeat(60));
    console.log('🧪 TESTE DO WEBHOOK EVOLUTION - FLUXO ATIVAR_TESTE');
    console.log('='.repeat(60));
    console.log('\n⚠️  IMPORTANTE: O backend precisa estar rodando na porta 3000\n');

    try {
        // Teste 1: Comando ATIVAR_TESTE (formato BotBot Resposta)
        await sendWebhook({
            senderPhone: '5547999999999',
            senderMessage: 'ATIVAR_TESTE 123456 789012'
        }, 'ATIVAR_TESTE (formato BotBot Resposta)');

        await new Promise(r => setTimeout(r, 500));

        // Teste 2: Comando ATIVAR_TESTE (formato Evolution API)
        await sendWebhook({
            data: {
                key: {
                    remoteJid: '5547888888888@s.whatsapp.net',
                    fromMe: false
                },
                message: {
                    conversation: 'ATIVAR_TESTE usuario_teste senha_teste'
                }
            }
        }, 'ATIVAR_TESTE (formato Evolution API)');

        await new Promise(r => setTimeout(r, 500));

        // Teste 3: Comando client_code (para vincular numero)
        await sendWebhook({
            senderPhone: '5547777777777',
            senderMessage: 'teste iptv cliente ABC123'
        }, 'Client Code (para vincular numero)');

        await new Promise(r => setTimeout(r, 500));

        // Teste 4: Mensagem nao reconhecida (deve ser ignorada)
        await sendWebhook({
            senderPhone: '5547666666666',
            senderMessage: 'Oi, bom dia!'
        }, 'Mensagem comum (deve ser ignorada)');

        await new Promise(r => setTimeout(r, 500));

        // Teste 5: ATIVAR_TESTE case insensitive
        await sendWebhook({
            senderPhone: '5547555555555',
            senderMessage: 'ativar_teste Login123 Senha456'
        }, 'ATIVAR_TESTE case insensitive');

        console.log('\n' + '='.repeat(60));
        console.log('✅ Testes concluidos! Verifique os logs do backend.');
        console.log('='.repeat(60) + '\n');

    } catch (error) {
        console.error('\n❌ Erro ao executar testes:', error.message);
        console.log('\n💡 Certifique-se que o backend esta rodando:');
        console.log('   cd backend-iptv-main && node index.js\n');
    }
}

runTests();
