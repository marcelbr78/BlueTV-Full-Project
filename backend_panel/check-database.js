/**
 * Script para verificar se as credenciais foram salvas no banco
 */

const db = require('./db');

console.log('\n' + '='.repeat(70));
console.log('🔍 VERIFICANDO BANCO DE DADOS - ATIVAR_TESTE');
console.log('='.repeat(70) + '\n');

// Consultar credenciais Xtream
db.all(
    `SELECT 
        id, 
        whatsapp_number, 
        host, 
        username, 
        password,
        validade,
        extracted_at
    FROM xtream_credentials 
    ORDER BY id DESC 
    LIMIT 10`,
    [],
    (err, credentials) => {
        if (err) {
            console.error('❌ Erro ao consultar xtream_credentials:', err.message);
            return;
        }

        console.log('📋 CREDENCIAIS XTREAM (últimas 10):');
        console.log('-'.repeat(70));

        if (credentials.length === 0) {
            console.log('⚠️  Nenhuma credencial encontrada no banco.\n');
        } else {
            credentials.forEach(cred => {
                const date = new Date(cred.extracted_at);
                console.log(`\n✅ ID: ${cred.id}`);
                console.log(`   📱 WhatsApp: ${cred.whatsapp_number}`);
                console.log(`   🌐 Host: ${cred.host}`);
                console.log(`   👤 Username: ${cred.username}`);
                console.log(`   🔐 Password: ${cred.password}`);
                console.log(`   📅 Validade: ${cred.validade || 'não definida'}`);
                console.log(`   ⏰ Data: ${date.toLocaleString('pt-BR')}`);
            });
            console.log('\n' + '-'.repeat(70));
        }

        // Consultar app_requests
        db.all(
            `SELECT 
                id, 
                client_code, 
                device_id,
                whatsapp_number, 
                status, 
                xtream_id,
                created_at,
                updated_at
            FROM app_requests 
            ORDER BY id DESC 
            LIMIT 10`,
            [],
            (err2, requests) => {
                if (err2) {
                    console.error('❌ Erro ao consultar app_requests:', err2.message);
                    return;
                }

                console.log('\n📋 APP REQUESTS (últimas 10):');
                console.log('-'.repeat(70));

                if (requests.length === 0) {
                    console.log('⚠️  Nenhum request encontrado no banco.\n');
                } else {
                    requests.forEach(req => {
                        const created = new Date(req.created_at);
                        const updated = new Date(req.updated_at);
                        console.log(`\n📝 ID: ${req.id}`);
                        console.log(`   🔤 Client Code: ${req.client_code}`);
                        console.log(`   📱 WhatsApp: ${req.whatsapp_number || 'não vinculado'}`);
                        console.log(`   📱 Device ID: ${req.device_id || 'não definido'}`);
                        console.log(`   📊 Status: ${req.status}`);
                        console.log(`   🎫 Xtream ID: ${req.xtream_id || 'não vinculado'}`);
                        console.log(`   📅 Criado: ${created.toLocaleString('pt-BR')}`);
                        console.log(`   ♻️  Atualizado: ${updated.toLocaleString('pt-BR')}`);
                    });
                    console.log('\n' + '-'.repeat(70));
                }

                // Verificar se a mensagem específica foi salva
                console.log('\n🔎 PROCURANDO por login="meulogin" ...');
                db.get(
                    `SELECT * FROM xtream_credentials WHERE username = ? ORDER BY id DESC LIMIT 1`,
                    ['meulogin'],
                    (err3, found) => {
                        if (err3) {
                            console.error('❌ Erro:', err3.message);
                        } else if (found) {
                            console.log('✅ ENCONTRADO! A mensagem ATIVAR_TESTE foi processada com sucesso!');
                            console.log(`   ID: ${found.id}`);
                            console.log(`   Telefone: ${found.whatsapp_number}`);
                            console.log(`   Host: ${found.host}`);
                            console.log(`   Username: ${found.username}`);
                            console.log(`   Password: ${found.password}`);
                        } else {
                            console.log('❌ NÃO ENCONTRADO. A mensagem pode não ter sido processada.');
                            console.log('   Verifique se:');
                            console.log('   1. O backend está rodando');
                            console.log('   2. A Evolution API está conectada');
                            console.log('   3. O webhook está configurado corretamente');
                        }

                        console.log('\n' + '='.repeat(70) + '\n');
                        process.exit(0);
                    }
                );
            }
        );
    }
);
