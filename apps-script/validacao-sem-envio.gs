function arquemPrepararPreviaSemEnvio() {
  const props=PropertiesService.getScriptProperties();
  if(!props.getProperty('MAIL_SECRET'))throw new Error('MAIL_SECRET ausente; interrompido.');
  const templateId='1T7dKL5aJA6dPoAUmfmtV4_ywDNwgaAE9nGy62o59gLA';
  const file=DriveApp.getFileById(templateId);
  if(file.getMimeType()!==MimeType.GOOGLE_DOCS)throw new Error('Modelo deve ser Google Docs.');
  const current=props.getProperty('ARQUEM_PAPEL_TIMBRADO_DOC_ID');
  if(current && current!==templateId)throw new Error('Modelo configurado difere do modelo autorizado; revisar antes de alterar.');
  props.setProperty('ARQUEM_PAPEL_TIMBRADO_DOC_ID',templateId);
  return arquemTesteAnexosSemEnvio(true);
}


