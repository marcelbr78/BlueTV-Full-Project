/**
 * BlueTV Backend - Configurações
 */

module.exports = {
    // Servidor
    PORT: process.env.PORT || 3000,

    // Sessão admin
    INACTIVITY_TIMEOUT: 15 * 60 * 1000, // 15 minutos

    // API Key para o APP BlueTV (gerada aleatoriamente)
    APP_API_KEY: process.env.APP_API_KEY || 'btv_k8x2mP9qL4wN7vR3jY6cT1hB5fA0eZ',

    // WhatsApp do painel IPTV (para identificar respostas de teste)
    // Deixe vazio para aceitar de qualquer número, ou configure o número específico
    IPTV_PANEL_NUMBER: process.env.IPTV_PANEL_NUMBER || '47997193147',

    // Número padrão para link wa.me
    WHATSAPP_NUMBER: process.env.WHATSAPP_NUMBER || '5511999999999',

    // DNS fixo do servidor Xtream (usado no fluxo ATIVAR_TESTE)
    // OBS: Não é mais estritamente necessário para extração automática (DNS agora é extraído da mensagem)
    XTREAM_DNS_FIXO: process.env.XTREAM_DNS_FIXO || 'http://dns.servidor-iptv.com:80',

    // Número da Evolution API (onde cliente envia ATIVAR_TESTE)
    EVOLUTION_NUMBER: process.env.EVOLUTION_NUMBER || '5547997193147'
};
