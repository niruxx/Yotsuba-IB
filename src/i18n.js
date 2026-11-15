import { AsyncLocalStorage } from 'node:async_hooks';

const context = new AsyncLocalStorage();
export const LANGUAGES = { en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', pt: 'Português', ja: '日本語', ru: 'Русский', zh: '简体中文' };
const keys = 'Boards|Theme|Language|search|settings|admin|Name|Options|Subject|Comment|File|Password|New thread|Post reply|Index|Catalog|Archive|Search|Return|Bottom|Top|Board rules|Spoiler|Delete|Report|Filter|Username|Log in|Admin login|My account|Change password|Current password|New password|Settings|Close|Reply|Watch|Update|No threads yet.|No threads yet. Start one!|Anonymous|Verification code|Refresh challenge|Authenticator or recovery code|Two-factor authentication|Enable|Disable|Save settings|Favorites|All boards|Yotsuba|Yotsuba B|Tomorrow (dark)|Quotes & Replying|Monitoring|Filters & Post Hiding|Navigation|Images & Media|Miscellaneous'.split('|');
const rows = {
 es: 'Tablones|Tema|Idioma|buscar|ajustes|administración|Nombre|Opciones|Asunto|Comentario|Archivo|Contraseña|Nuevo hilo|Responder|Índice|Catálogo|Archivo|Buscar|Volver|Abajo|Arriba|Reglas del tablón|Ocultar|Eliminar|Denunciar|Filtrar|Usuario|Iniciar sesión|Acceso de administración|Mi cuenta|Cambiar contraseña|Contraseña actual|Nueva contraseña|Ajustes|Cerrar|Responder|Seguir|Actualizar|Aún no hay hilos.|¡Inicia el primer hilo!|Anónimo|Código de verificación|Renovar desafío|Código de autenticación o recuperación|Autenticación de dos factores|Activar|Desactivar|Guardar ajustes|Favoritos|Todos los tablones|Yotsuba|Yotsuba B|Tomorrow (oscuro)|Citas y respuestas|Seguimiento|Filtros y ocultación|Navegación|Imágenes y multimedia|Otros',
 fr: 'Forums|Thème|Langue|rechercher|paramètres|administration|Nom|Options|Sujet|Commentaire|Fichier|Mot de passe|Nouveau fil|Répondre|Index|Catalogue|Archives|Rechercher|Retour|Bas|Haut|Règles du forum|Masquer|Supprimer|Signaler|Filtrer|Identifiant|Connexion|Connexion administrateur|Mon compte|Changer le mot de passe|Mot de passe actuel|Nouveau mot de passe|Paramètres|Fermer|Répondre|Suivre|Actualiser|Aucun fil.|Créez le premier fil !|Anonyme|Code de vérification|Nouveau défi|Code authentificateur ou de secours|Authentification à deux facteurs|Activer|Désactiver|Enregistrer|Favoris|Tous les forums|Yotsuba|Yotsuba B|Tomorrow (sombre)|Citations et réponses|Suivi|Filtres et masquage|Navigation|Images et médias|Divers',
 de: 'Boards|Design|Sprache|suchen|Einstellungen|Verwaltung|Name|Optionen|Betreff|Kommentar|Datei|Passwort|Neues Thema|Antworten|Übersicht|Katalog|Archiv|Suchen|Zurück|Unten|Oben|Boardregeln|Verbergen|Löschen|Melden|Filtern|Benutzername|Anmelden|Admin-Anmeldung|Mein Konto|Passwort ändern|Aktuelles Passwort|Neues Passwort|Einstellungen|Schließen|Antworten|Beobachten|Aktualisieren|Noch keine Themen.|Erstelle das erste Thema!|Anonym|Bestätigungscode|Neue Aufgabe|Authenticator- oder Wiederherstellungscode|Zwei-Faktor-Authentifizierung|Aktivieren|Deaktivieren|Einstellungen speichern|Favoriten|Alle Boards|Yotsuba|Yotsuba B|Tomorrow (dunkel)|Zitate und Antworten|Beobachtung|Filter und Ausblenden|Navigation|Bilder und Medien|Sonstiges',
 pt: 'Fóruns|Tema|Idioma|buscar|configurações|administração|Nome|Opções|Assunto|Comentário|Arquivo|Senha|Novo tópico|Responder|Índice|Catálogo|Arquivo|Buscar|Voltar|Fim|Início|Regras do fórum|Ocultar|Excluir|Denunciar|Filtrar|Usuário|Entrar|Acesso administrativo|Minha conta|Alterar senha|Senha atual|Nova senha|Configurações|Fechar|Responder|Acompanhar|Atualizar|Nenhum tópico ainda.|Crie o primeiro tópico!|Anônimo|Código de verificação|Novo desafio|Código do autenticador ou de recuperação|Autenticação de dois fatores|Ativar|Desativar|Salvar configurações|Favoritos|Todos os fóruns|Yotsuba|Yotsuba B|Tomorrow (escuro)|Citações e respostas|Monitoramento|Filtros e ocultação|Navegação|Imagens e mídia|Outros',
 ja: '掲示板|テーマ|言語|検索|設定|管理|名前|オプション|件名|コメント|ファイル|パスワード|新規スレッド|返信する|一覧|カタログ|過去ログ|検索|戻る|下へ|上へ|掲示板のルール|ネタバレ|削除|報告|絞り込み|ユーザー名|ログイン|管理者ログイン|マイアカウント|パスワード変更|現在のパスワード|新しいパスワード|設定|閉じる|返信|ウォッチ|更新|スレッドはありません。|最初のスレッドを作成しましょう！|匿名|認証コード|別の問題|認証アプリまたは復旧コード|二要素認証|有効化|無効化|設定を保存|お気に入り|すべての掲示板|Yotsuba|Yotsuba B|Tomorrow（ダーク）|引用と返信|モニタリング|フィルターと非表示|ナビゲーション|画像とメディア|その他',
 ru: 'Доски|Тема|Язык|поиск|настройки|администрирование|Имя|Параметры|Тема|Комментарий|Файл|Пароль|Новая тема|Ответить|Главная|Каталог|Архив|Поиск|Назад|Вниз|Вверх|Правила доски|Спойлер|Удалить|Пожаловаться|Фильтр|Имя пользователя|Войти|Вход администратора|Мой аккаунт|Сменить пароль|Текущий пароль|Новый пароль|Настройки|Закрыть|Ответить|Следить|Обновить|Тем пока нет.|Создайте первую тему!|Аноним|Код проверки|Новая проверка|Код приложения или восстановления|Двухфакторная аутентификация|Включить|Отключить|Сохранить настройки|Избранное|Все доски|Yotsuba|Yotsuba B|Tomorrow (тёмная)|Цитаты и ответы|Наблюдение|Фильтры и скрытие|Навигация|Изображения и медиа|Прочее',
 zh: '版块|主题|语言|搜索|设置|管理|名称|选项|标题|评论|文件|密码|新建主题|回复|索引|目录|存档|搜索|返回|底部|顶部|版规|剧透|删除|举报|筛选|用户名|登录|管理员登录|我的账户|修改密码|当前密码|新密码|设置|关闭|回复|关注|刷新|暂无主题。|创建第一个主题！|匿名|验证码|更换验证码|认证器或恢复码|双重验证|启用|禁用|保存设置|收藏|全部版块|Yotsuba|Yotsuba B|Tomorrow（深色）|引用和回复|监控|筛选和隐藏|导航|图片和媒体|其他',
};
export const CATALOGS = Object.fromEntries(Object.entries(rows).map(([lang, row]) => [lang, Object.fromEntries(keys.map((key, i) => [key, row.split('|')[i] || key]))]));
const ageKeys = ['Age-restricted content. Adults 18 and older only.', 'I confirm that I am 18 or older and wish to view this content.', 'Leave / Go back to homepage', 'Continue to board'];
const ageTranslations = {
 es: ['Contenido restringido por edad. Solo para mayores de 18 años.', 'Confirmo que tengo 18 años o más y deseo ver este contenido.', 'Salir / Volver al inicio', 'Continuar al tablón'],
 fr: ['Contenu réservé aux adultes de 18 ans et plus.', 'Je confirme avoir au moins 18 ans et souhaiter voir ce contenu.', 'Quitter / Retour à l’accueil', 'Accéder au forum'],
 de: ['Altersbeschränkter Inhalt. Nur für Erwachsene ab 18 Jahren.', 'Ich bestätige, dass ich mindestens 18 Jahre alt bin und diesen Inhalt sehen möchte.', 'Verlassen / Zur Startseite', 'Weiter zum Board'],
 pt: ['Conteúdo restrito por idade. Apenas para maiores de 18 anos.', 'Confirmo que tenho 18 anos ou mais e desejo ver este conteúdo.', 'Sair / Voltar ao início', 'Continuar para o fórum'],
 ja: ['年齢制限のあるコンテンツです。18歳以上の方のみ閲覧できます。', '私は18歳以上であり、このコンテンツの閲覧を希望します。', '退出 / ホームに戻る', '掲示板に進む'],
 ru: ['Контент с возрастным ограничением. Только для лиц от 18 лет.', 'Я подтверждаю, что мне исполнилось 18 лет и я хочу просмотреть этот контент.', 'Выйти / На главную', 'Перейти на доску'],
 zh: ['年龄限制内容。仅限18岁及以上的成年人。', '我确认已年满18岁，并希望查看此内容。', '离开 / 返回首页', '进入版块'],
};
for (const [language, values] of Object.entries(ageTranslations)) Object.assign(CATALOGS[language], Object.fromEntries(ageKeys.map((key, i) => [key, values[i]])));
for (const [language, values] of Object.entries({ es: ['Apariencia', 'Predeterminado del sitio'], fr: ['Apparence', 'Thème du site'], de: ['Darstellung', 'Website-Standard'], pt: ['Aparência', 'Padrão do site'], ja: ['外観', 'サイトの既定'], ru: ['Оформление', 'Тема сайта'], zh: ['外观', '网站默认'] })) {
  Object.assign(CATALOGS[language], { Appearance: values[0], 'Site default': values[1] });
}
const drawingKeys = ['Draw an image', 'Brush color', 'Brush size', 'Tool', 'Brush', 'Eraser', 'Undo', 'Redo', 'Clear canvas', 'Attach drawing to post', 'Download PNG', 'Hide drawing tools', 'My boards', 'Account'];
const discoveryKeys = ['Boards & trends', 'Board directory', 'Trending boards', 'Favorite', 'Unfavorite', 'Webring', 'Bold', 'Italic', 'Underline', 'Strike', 'ASCII art', 'Code', 'Load video', 'Unload video', 'External player: loading shares your IP with this provider.'];
for (const [language, row] of Object.entries({
 es: 'Tablones y tendencias|Directorio de tablones|Tablones en tendencia|Añadir a favoritos|Quitar de favoritos|Comunidades enlazadas|Negrita|Cursiva|Subrayado|Tachado|Arte ASCII|Código|Cargar vídeo|Cerrar vídeo|Reproductor externo: al cargarlo compartes tu IP con este proveedor.',
 fr: 'Forums et tendances|Annuaire des forums|Forums populaires|Ajouter aux favoris|Retirer des favoris|Réseau de communautés|Gras|Italique|Souligné|Barré|Art ASCII|Code|Charger la vidéo|Fermer la vidéo|Lecteur externe : son chargement partage votre IP avec ce fournisseur.',
 de: 'Boards und Trends|Boardverzeichnis|Beliebte Boards|Favorisieren|Favorit entfernen|Community-Netzwerk|Fett|Kursiv|Unterstrichen|Durchgestrichen|ASCII-Kunst|Code|Video laden|Video schließen|Externer Player: Beim Laden wird Ihre IP mit diesem Anbieter geteilt.',
 pt: 'Fóruns e tendências|Diretório de fóruns|Fóruns em destaque|Favoritar|Remover favorito|Rede de comunidades|Negrito|Itálico|Sublinhado|Tachado|Arte ASCII|Código|Carregar vídeo|Fechar vídeo|Reprodutor externo: ao carregar, seu IP é compartilhado com este provedor.',
 ja: '掲示板とトレンド|掲示板一覧|注目の掲示板|お気に入りに追加|お気に入りを解除|コミュニティリンク|太字|斜体|下線|取り消し線|アスキーアート|コード|動画を読み込む|動画を閉じる|外部プレーヤー：読み込むと、この配信元にIPアドレスが共有されます。',
 ru: 'Доски и тренды|Каталог досок|Популярные доски|В избранное|Убрать из избранного|Сеть сообществ|Жирный|Курсив|Подчёркнутый|Зачёркнутый|ASCII-арт|Код|Загрузить видео|Закрыть видео|Внешний плеер: при загрузке ваш IP передаётся этому провайдеру.',
 zh: '版块与趋势|版块目录|热门版块|收藏|取消收藏|社区环|粗体|斜体|下划线|删除线|ASCII字符画|代码|加载视频|关闭视频|外部播放器：加载时会向此服务商共享您的IP地址。',
})) Object.assign(CATALOGS[language], Object.fromEntries(discoveryKeys.map((key, i) => [key, row.split('|')[i]])));
for (const [language, row] of Object.entries({
 es: 'Dibujar una imagen|Color del pincel|Tamaño del pincel|Herramienta|Pincel|Borrador|Deshacer|Rehacer|Limpiar lienzo|Adjuntar dibujo|Descargar PNG|Ocultar herramientas|Mis tablones|Cuenta',
 fr: 'Dessiner une image|Couleur du pinceau|Taille du pinceau|Outil|Pinceau|Gomme|Annuler|Rétablir|Effacer le dessin|Joindre le dessin|Télécharger PNG|Masquer les outils|Mes forums|Compte',
 de: 'Bild zeichnen|Pinselfarbe|Pinselgröße|Werkzeug|Pinsel|Radierer|Rückgängig|Wiederholen|Leinwand leeren|Zeichnung anhängen|PNG herunterladen|Zeichenwerkzeuge ausblenden|Meine Boards|Konto',
 pt: 'Desenhar uma imagem|Cor do pincel|Tamanho do pincel|Ferramenta|Pincel|Borracha|Desfazer|Refazer|Limpar tela|Anexar desenho|Baixar PNG|Ocultar ferramentas|Meus fóruns|Conta',
 ja: '画像を描く|ブラシの色|ブラシのサイズ|ツール|ブラシ|消しゴム|元に戻す|やり直す|キャンバスを消去|絵を添付|PNGをダウンロード|描画ツールを閉じる|自分の掲示板|アカウント',
 ru: 'Нарисовать изображение|Цвет кисти|Размер кисти|Инструмент|Кисть|Ластик|Отменить|Повторить|Очистить холст|Прикрепить рисунок|Скачать PNG|Скрыть инструменты|Мои доски|Аккаунт',
 zh: '绘制图片|画笔颜色|画笔大小|工具|画笔|橡皮擦|撤销|重做|清空画布|附加绘图|下载PNG|隐藏绘图工具|我的版块|账户',
})) Object.assign(CATALOGS[language], Object.fromEntries(drawingKeys.map((key, i) => [key, row.split('|')[i]])));
export const t = (key) => CATALOGS[context.getStore()]?.[key] || key;
export const withLanguage = (language, fn) => context.run(language, fn);
export function languageMiddleware(req, res, next) {
  const value = /(?:^|;\s*)language=([a-z]{2})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  req.language = Object.hasOwn(LANGUAGES, value || '') ? value : 'en';
  res.vary('Cookie');
  withLanguage(req.language, next);
}
