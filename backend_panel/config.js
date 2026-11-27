/**
 * BlueTV Backend - Configurações
 */

module.exports = {
    // Servidor
    PORT: process.env.PORT || 3000,

    // Sessão admin
    INACTIVITY_TIMEOUT: 15 * 60 * 1000, // 15 minutos

    // A chave deve vir do ambiente (no Render, use o valor gerado do Blueprint).
    APP_API_KEY: process.env.APP_API_KEY || '',

    // WhatsApp do painel IPTV (para identificar respostas de teste)
    // Deixe vazio para aceitar de qualquer número, ou configure o número específico
    IPTV_PANEL_NUMBER: process.env.IPTV_PANEL_NUMBER || '47997193147',

    // Número padrão para link wa.me
    WHATSAPP_NUMBER: process.env.WHATSAPP_NUMBER || '5511999999999',

    // API-Football e conta Xtream de referência para dados esportivos
    FOOTBALL_API_KEY: process.env.FOOTBALL_API_KEY || '',
    XTREAM_REF_HOST: process.env.XTREAM_REF_HOST || '',
    XTREAM_REF_USER: process.env.XTREAM_REF_USER || '',
    XTREAM_REF_PASS: process.env.XTREAM_REF_PASS || '',

    // DNS fixo do servidor Xtream (usado no fluxo ATIVAR_TESTE)
    // OBS: Não é mais estritamente necessário para extração automática (DNS agora é extraído da mensagem)
    XTREAM_DNS_FIXO: process.env.XTREAM_DNS_FIXO || 'http://dns.servidor-iptv.com:80',

    // Número da Evolution API (onde cliente envia ATIVAR_TESTE)
    EVOLUTION_NUMBER: process.env.EVOLUTION_NUMBER || '5547997193147'
};
