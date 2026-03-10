# BlueTV Backend - Resumo do Projeto

## Status Atual: Backend pronto para fluxo ATIVAR_TESTE (INBOUND apenas)

## Ultima Atualizacao: 2026-01-22

## IMPORTANTE - Limitacao Tecnica
A Evolution API so consegue capturar mensagens RECEBIDAS (inbound).
NAO e possivel capturar mensagens ENVIADAS pelo proprio WhatsApp.
Qualquer logica de outbound foi REMOVIDA deste projeto.

## O Que Foi Feito

### 1. Backend Node.js/Express/SQLite
- Localizacao: C:\Users\loja\.gemini\antigravity\scratch\backend-iptv-main\
- Porta: 3000
- API Key: btv_k8x2mP9qL4wN7vR3jY6cT1hB5fA0eZ

### 2. Fluxo ATIVAR_TESTE (Como Funciona)
1. BotBot/Painel IPTV envia login+senha ao cliente
2. BotBot envia botao "ATIVAR TESTE" com link wa.me pre-preenchido:
   - Formato: https://wa.me/5547997193147?text=ATIVAR_TESTE%20<LOGIN>%20<SENHA>
3. Cliente clica no botao -> abre WhatsApp com mensagem pre-preenchida
4. Cliente CONFIRMA o envio -> mensagem INBOUND e capturada pela Evolution
5. Evolution envia webhook para o backend
6. Backend extrai login/senha usando regex, aplica DNS fixo, salva credenciais
7. App consulta /app/status e recebe as credenciais

### 3. Configuracoes (config.js)
- XTREAM_DNS_FIXO: http://dns.servidor-iptv.com:80
- EVOLUTION_NUMBER: 5547997193147 (numero para cliente enviar ATIVAR_TESTE)
- IPTV_PANEL_NUMBER: 47997193147

### 4. Parser do Comando ATIVAR_TESTE (parser.js)
- Funcao: parseAtivarTesteCommand(message)
- Regex: /^ATIVAR_TESTE\s+(\S+)\s+(\S+)$/i
- Retorna: { success, login, senha }
- Case insensitive, tolerante a espacos extras

### 5. Webhook /webhook/evolution
- Recebe APENAS mensagens INBOUND
- Detecta comando ATIVAR_TESTE <login> <senha>
- Usa DNS fixo (nao extrai da mensagem)
- Salva em xtream_credentials
- Atualiza ou cria app_request
- NAO tenta capturar mensagens outbound

### 6. Evolution API (Docker)
- Localizacao: C:\Users\loja\.gemini\antigravity\scratch\evolution-api\
- docker-compose.yml configurado
- Webhook URL: http://host.docker.internal:3000/webhook/evolution
- Instancia conectada: bluetv

### 7. Endpoints Principais
- POST /webhook/evolution - Recebe mensagens da Evolution API
- POST /app/request - App solicita codigo de ativacao
- GET /app/status - App consulta status (polling)
- GET /admin - Painel administrativo

### 8. Arquivos Importantes
- index.js - Servidor principal (webhook atualizado)
- config.js - Configuracoes (DNS fixo)
- parser.js - Parser de credenciais (inclui parseAtivarTesteCommand)
- db.js - Banco SQLite

## Proximos Passos Pendentes
1. Configurar DNS Xtream REAL em config.js (substituir http://dns.servidor-iptv.com:80)
2. Configurar BotBot para enviar botao com link wa.me:
   - https://wa.me/5547997193147?text=ATIVAR_TESTE%20{login}%20{senha}
3. Testar fluxo completo enviando "ATIVAR_TESTE 123 456" para o numero Evolution
4. Deploy no Render (ja esta no GitHub)
5. Implementar app Android

## Exemplo de Teste Manual
Envie esta mensagem para o numero da Evolution (5547997193147):
```
ATIVAR_TESTE meulogin minhasenha
```

O backend vai:
1. Detectar o comando
2. Extrair login=meulogin, senha=minhasenha
3. Usar DNS fixo configurado
4. Salvar credenciais no banco
5. Retornar para o app via /app/status

## GitHub
Repositorio local: C:\Users\loja\.gemini\antigravity\scratch\backend-iptv-main\
