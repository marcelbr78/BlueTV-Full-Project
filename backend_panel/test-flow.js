/**
 * Teste completo do fluxo BlueTV
 * 
 * Simula:
 * 1. App solicita teste (/app/request)
 * 2. Evolution envia credenciais (/webhook/evolution)
 * 3. App consulta status (/app/status)
 * 
 * Execução: node test-flow.js
 */

const http = require('http');

const API_KEY = 'btv_k8x2mP9qL4wN7vR3jY6cT1hB5fA0eZ';
const PHONE = '5511999999999';

function makeRequest(options, data = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(body) });
                } catch {
                    resolve({ status: res.statusCode, data: body });
                }
            });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

async function runTest() {
    console.log('='.repeat(60));
    console.log('🧪 TESTE COMPLETO DO FLUXO BLUETV');
    console.log('='.repeat(60));

    // STEP 1: App solicita teste
    console.log('\n📱 PASSO 1: App solicita teste IPTV...');

    const requestData = JSON.stringify({
        device_id: 'test-device-123',
        whatsapp_number: PHONE
    });

    const step1 = await makeRequest({
        hostname: 'localhost',
        port: 3000,
        path: '/app/request',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': API_KEY,
            'Content-Length': Buffer.byteLength(requestData)
        }
    }, requestData);

    console.log(`   Status: ${step1.status}`);
    console.log(`   Response:`, step1.data);

    if (!step1.data.request_id) {
        console.log('❌ Falha ao criar request');
        return;
    }

    const requestId = step1.data.request_id;
    console.log(`   ✅ Request ID: ${requestId}`);

    // STEP 2: Simular Evolution enviando credenciais
    console.log('\n📨 PASSO 2: Simulando Evolution API enviando credenciais...');

    const evolutionPayload = JSON.stringify({
        event: 'messages.upsert',
        data: {
            key: { remoteJid: PHONE + '@s.whatsapp.net', client_code: requestId },
            message: {
                conversation: `*MEGGA IPTV*
📡 Dns/Url: http://megga10.top:80
👤 USUÁRIO: 36228424
🔐 SENHA:  26136519
🗓️ *Vencimento:* 04/02/2026 23:59:59`
            }
        }
    });

    const step2 = await makeRequest({
        hostname: 'localhost',
        port: 3000,
        path: '/webhook/evolution',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(evolutionPayload)
        }
    }, evolutionPayload);

    console.log(`   Status: ${step2.status}`);
    console.log(`   Response:`, step2.data);
    console.log('   ✅ Webhook processado');

    // Aguardar processamento
    await new Promise(r => setTimeout(r, 500));

    // STEP 3: App consulta status
    console.log('\n🔄 PASSO 3: App consulta status (polling)...');

    const step3 = await makeRequest({
        hostname: 'localhost',
        port: 3000,
        path: `/app/status?request_id=${requestId}&api_key=${API_KEY}`,
        method: 'GET'
    });

    console.log(`   Status: ${step3.status}`);
    console.log(`   Response:`, JSON.stringify(step3.data, null, 2));

    // RESULTADO
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESULTADO DO TESTE');
    console.log('='.repeat(60));

    if (step3.data.status === 'ok' && step3.data.xtream) {
        console.log('✅ SUCESSO! Credenciais Xtream recebidas:');
        console.log(`   Host:     ${step3.data.xtream.host}`);
        console.log(`   Username: ${step3.data.xtream.username}`);
        console.log(`   Password: ${step3.data.xtream.password}`);
        console.log(`   Validade: ${step3.data.xtream.validade}`);
        console.log('\n🎉 O fluxo completo está funcionando!');
    } else {
        console.log('⚠️ Status:', step3.data.status);
        console.log('   O request pode ainda estar pendente ou não foi vinculado.');
    }
}

runTest().catch(err => {
    console.error('❌ Erro:', err.message);
    console.log('\n⚠️ Certifique-se que o backend está rodando:');
    console.log('   cd backend-iptv-main');
    console.log('   node index.js');
});
