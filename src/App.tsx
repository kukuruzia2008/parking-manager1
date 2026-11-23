import { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { isSupabaseConfigured, supabase } from './supabase';
import {
  LayoutDashboard, MapPinned, CalendarDays, ClipboardList, UserRound, Search,
  Bell, Plus, CarFront, Wallet, Clock3, CheckCircle2, CircleParking,
  ChevronRight, Download, QrCode, Ticket, Settings, LogOut, MapPin,
  X, CreditCard, Smartphone, Heart, ShieldCheck, Navigation, Info,
  CircleHelp, SlidersHorizontal, Trash2, Pencil, RefreshCw, KeyRound,
  Zap, ParkingCircle, FileText, CalendarClock, BadgePercent, Building2, Volume2, VolumeX, CornerUpLeft, CornerUpRight, ArrowUp, RotateCcw
} from 'lucide-react';

type Screen = 'Главная' | 'Парковки' | 'Навигатор' | 'Бронирование' | 'История' | 'Статистика' | 'Профиль';
type SpotStatus = 'Свободно' | 'Занято' | 'Забронировано';
type BookingStatus = 'Ожидает оплаты' | 'Подтверждено' | 'Активно' | 'Завершено' | 'Отменено';
type Spot = { id:number; zone:string; status:SpotStatus; type:string; price:number; parkingId?:number };
type Booking = { id:string; person:string; ownerEmail?:string; car:string; spot:string; parkingId?:number; parkingName?:string; parkingAddress?:string; date:string; start:string; end:string; amount:number; hourlyRate?:number; subscriptionDiscountPct?:number; createdAt?:string; status:BookingStatus; payment:string; pass:string; entrySimulated?:boolean; entryTime?:string; exitTime?:string; refundedAt?:string; reminderSent?:boolean };
type Vehicle = {id:number; plate:string; make:string; model:string; color:string; photo?:string; tagId?:string; chipEnabled?:boolean};
type Notice = {id:number; title:string; text:string; time:string; read:boolean};
type PaymentRecord = {id:string; bookingId:string; amount:number; method:string; status:'Успешно'|'Отклонено'|'Отменено'|'Возвращён'; createdAt:string; receiptNo:string; relatedPaymentId?:string};
type PaymentMethod = {id:string;kind:'card'|'sbp';label:string;details:string};
type RouteOrigin = {lat:number;lon:number} | null;
type DrivingRouteStep = {instruction:string;road:string;distance:number;duration:number;routeIndex:number;location:[number,number]};
type DrivingRoute = {geometry:{coordinates:[number,number][]};distance:number;duration:number;steps:DrivingRouteStep[];start:[number,number];end:[number,number]};
function createParkingSpotsForLot(lotId:number):Spot[]{
 const id=Math.max(1,Math.abs(Math.trunc(Number(lotId)||1)));
 const total=18+((id*13+11)%25); // вместимость отличается у разных парковок
 const zoneACount=Math.ceil(total*.55);
 let seed=(id*9301+49297)%233280;
 const random=()=>{seed=(seed*9301+49297)%233280;return seed/233280};
 return Array.from({length:total},(_,i)=>{
  const r=random();
  const status:SpotStatus=r<.62?'Свободно':r<.88?'Занято':'Забронировано';
  return {id:i+1,zone:i<zoneACount?'A':'B',status,type:(i+1)%11===0?'Для электромобилей':(i+1)%17===0?'Для людей с ОВЗ':'Стандартное',price:200,parkingId:id};
 });
}
function readParkingSpotsForLot(lotId:number):Spot[]{
 const id=Math.max(1,Math.abs(Math.trunc(Number(lotId)||1)));
 const key=`pm2_spots_lot_${id}`;
 try{
  const saved=JSON.parse(localStorage.getItem(key)||'null');
  if(Array.isArray(saved)&&saved.length&&saved.every((s:any)=>Number(s.parkingId||id)===id&&Number.isFinite(Number(s.id)))){
   return saved.map((s:any)=>({...s,parkingId:id}));
  }
 }catch{}
 const fresh=createParkingSpotsForLot(id);
 try{localStorage.setItem(key,JSON.stringify(fresh))}catch{}
 return fresh;
}
function vehicleChipId(v:any):string{
 const base=String(v?.plate||v?.id||'CAR').toUpperCase().replace(/[^A-Z0-9А-Я]/g,'').slice(-8)||'CAR';
 return `PM-CHIP-${base}-${Number(v?.id||0).toString(36).toUpperCase()}`;
}

const NAV = [
  {name:'Главная' as Screen, icon:LayoutDashboard},
  {name:'Парковки' as Screen, icon:MapPinned},
  {name:'Навигатор' as Screen, icon:Navigation},
  {name:'Бронирование' as Screen, icon:CalendarDays},
  {name:'История' as Screen, icon:ClipboardList},
  {name:'Статистика' as Screen, icon:Wallet},
  {name:'Профиль' as Screen, icon:UserRound},
];
const seedBookings:Booking[] = [];
const seedVehicles:Vehicle[]=[{id:1,plate:'А123ВС 777',make:'Toyota',model:'Camry',color:'Белый'},{id:2,plate:'М456ОР 799',make:'Kia',model:'Rio',color:'Серый'}];
const seedNotices:Notice[]=[{id:1,title:'Бронирование подтверждено',text:'Место A-04 закреплено за вашим автомобилем.',time:'09:42',read:false},{id:2,title:'Напоминание о парковке',text:'До начала бронирования PM-1048 осталось 30 минут.',time:'Вчера',read:false}];
const SUBSCRIPTION_PLANS=[
 {id:'day',name:'На день',price:590,durationDays:1,durationLabel:'24 часа',discountPct:5,badge:'Для разовых поездок',description:'Подходит, когда нужно несколько раз припарковаться в течение одного дня.',features:['5% скидка на бронирования','Действует на всех парковках каталога','Подключение сразу после оплаты']},
 {id:'week',name:'На неделю',price:2490,durationDays:7,durationLabel:'7 дней',discountPct:10,badge:'Популярный выбор',description:'Для регулярных поездок в течение рабочей недели и выходных.',features:['10% скидка на каждое бронирование','Действует на всех парковках каталога','Одна подписка для всех добавленных автомобилей']},
 {id:'month',name:'На месяц',price:6900,durationDays:30,durationLabel:'30 дней',discountPct:15,badge:'Максимальная выгода',description:'Для тех, кто часто пользуется парковками и хочет экономить на каждой оплате.',features:['15% скидка на каждое бронирование','Действует на всех парковках каталога','Работает на всех парковках и для всех добавленных автомобилей']},
];
const todayISO=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
const money=(n:number)=>`${Math.round(n).toLocaleString('ru-RU')} ₽`;
const pad=(n:number)=>String(n).padStart(2,'0');
const spotName=(s:Spot)=>`${s.zone}${pad(s.id)}`;
function buildSupportReply(question:string):string{
 const q=question.toLowerCase().replace(/ё/g,'е');
 if(/зон[аы]?\s*[аб]|схем[аы]|свободн|занят|резерв|парковочн(ых|ые)\s+мест/.test(q)){
  return 'Схема парковки разделена на две части:\n\n• Зона A — первые 12 мест (A01–A12).\n• Зона B — следующие 12 мест (B13–B24).\n\nЦвета мест: зелёный — свободно и доступно для выбора; красный — занято; оранжевый — зарезервировано. Нажмите на зелёное место, чтобы выбрать его, затем нажмите «Забронировать». Занятые и зарезервированные места выбрать нельзя.\n\nЕсли места не отображаются, очистите поле «Поиск места» и выберите фильтр «Все зоны». Поиск парковки по адресу не должен фильтровать схему мест.';
 }
 if(/qr|пропуск|въезд|шлагбаум/.test(q)){
  return 'QR-пропуск доступен для подтверждённого бронирования до имитации въезда.\n\n1. Откройте раздел «История».\n2. Найдите бронь со статусом «Подтверждено» и нажмите «Пропуск».\n3. Покажите QR-код на экране.\n4. Нажмите «Сымитировать въезд», чтобы записать въезд в журнал.\n\nПосле имитации въезда пропуск помечается использованным: кнопка QR исчезает, а повторное открытие кода блокируется. QR — демонстрационный и не управляет реальным шлагбаумом.';
 }
 if(/брон|заброн|резерв/.test(q)){
  return 'Чтобы оформить бронирование:\n\n1. Откройте «Парковки» и выберите нужную парковку на карте или в каталоге.\n2. В схеме выберите зелёное свободное место в зоне A или B.\n3. Перейдите в «Бронирование», выберите автомобиль, дату и интервал времени.\n4. Проверьте стоимость и подтвердите заявку.\n5. Оплатите её средствами внутреннего баланса.\n\nЕсли нужного места нет в списке, проверьте фильтры зон и очистите поиск мест. Система не позволит пересечься по времени с другой бронью этого же места.';
 }
 if(/баланс|попол|оплат|карт|сбп|деньг/.test(q)){
  return 'Внутренний баланс находится в разделе «Профиль».\n\n1. Нажмите «Пополнить баланс».\n2. Выберите виртуальный способ: банковская карта или СБП.\n3. Если способ ещё не привязан, выберите «Привязать карту» или «Привязать СБП» и заполните тестовые данные.\n4. Укажите сумму и подтвердите демонстрационное пополнение.\n\nВажно: это учебный кошелёк. Банк не списывает и не переводит реальные деньги; данные настоящей карты вводить не нужно.';
 }
 if(/отмен/.test(q)){
  return 'Отменить бронирование можно в разделе «История»:\n\n1. Найдите нужную запись.\n2. Нажмите «Отменить».\n3. Подтвердите действие, если приложение попросит.\n\nПосле отмены статус изменится на «Отменено», QR-пропуск станет недоступен, а место вернётся в свободные, если на это время нет другой действующей брони. Если оплата была учебной, операция отражается в демо-журнале; реальный банковский возврат не выполняется.';
 }
 if(/избран|сердц/.test(q)){
  return 'Избранное работает отдельно для каждой парковки:\n\n• Нажмите на сердечко в карточке парковки или в блоке выбранной точки — она добавится в избранное.\n• Нажмите ещё раз — удалится.\n• В каталоге нажмите «Избранное», чтобы оставить на экране только сохранённые парковки.\n• В профиле можно открыть сохранённую парковку или удалить её из списка.\n\nЕсли список пуст, сначала поставьте сердечко хотя бы на одной парковке.';
 }
 if(/уведом/.test(q)){
  return 'Настройка уведомлений находится в «Профиль» → «Поддержка и настройки». Переключатель показывает текущее состояние: «Включены» или «Выключены». Когда уведомления выключены, приложение не создаёт новые локальные уведомления. Ранее созданные записи остаются в журнале.';
 }
 if(/маршрут|гео|местополож|навиг/.test(q)){
  return 'В Parking Manager встроен автомобильный навигатор по дорожной сети:\n\n1. Откройте «Парковки» и выберите нужную парковку.\n2. Нажмите кнопку со стрелкой «Построить маршрут».\n3. Разрешите браузеру доступ к геопозиции — навигатор определит стартовую точку.\n4. Приложение рассчитает путь по дорогам и покажет расстояние, примерное время и повороты.\n5. Нажмите «Начать движение», чтобы включить обновление GPS. При существенном отклонении маршрут будет перестроен.\n\nДля расчёта нужен интернет. Карта и маршрут отображаются внутри Parking Manager, без перехода на другой сайт и без чужих картографических тайлов. Время ориентировочное: данные о текущих пробках и временных перекрытиях не подключены.';
 }
 if(/аккаунт|вход|парол|регистрац|почт/.test(q)){
  return 'Аккаунт хранится локально в браузере и привязан к адресу электронной почты. Для повторного входа откройте вкладку «Вход» и укажите ту же почту и пароль, которые использовали при регистрации. Проверьте раскладку клавиатуры и отсутствие пробелов в конце адреса. Данные браузера не синхронизируются между разными компьютерами.';
 }
 if(/аватар|фото профил/.test(q)){
  return 'Чтобы установить аватарку, откройте «Профиль» → «Загрузить аватарку», выберите изображение JPG или PNG и дождитесь сообщения о сохранении. Фото хранится локально в браузере этого устройства. Если загрузка не проходит, попробуйте файл меньшего размера.';
 }
 if(/фото|снимок|изображен/.test(q)){
  return 'В каталоге карточки парковок показывают иллюстративные изображения. Они помогают визуально различать карточки, но не являются гарантированными актуальными фотографиями конкретной площадки. Выбранная парковка и её адрес отображаются отдельно в карточке.';
 }
 if(/ошибк|не работает|не открыва|не запуска|localhost|npm|терминал/.test(q)){
  return 'Давайте проверим запуск по порядку:\n\n1. Убедитесь, что в VS Code открыта папка проекта, где лежит package.json.\n2. Откройте Terminal → New Terminal.\n3. Выполните `npm.cmd install`.\n4. После успешной установки выполните `npm.cmd run dev`.\n5. Не закрывайте терминал и откройте адрес Local, который напечатает Vite.\n\nЕсли видите ENOENT с package.json, терминал открыт не в корне проекта. Пришлите снимок ошибки — подскажу точную команду.';
 }
 return 'Я помощник Parking Manager. Могу помочь с выбором парковки и места, зонами A/B, бронированием, QR-пропуском и имитацией въезда, внутренним балансом, отменой, избранным, уведомлениями, маршрутом, профилем и запуском проекта.\n\nНапишите, пожалуйста, что именно вы пытаетесь сделать и на каком экране возникла проблема. Я подскажу шаги и возможные причины, а не просто отправлю общую ссылку на инструкцию.';
}
const hoursBetween=(a:string,b:string)=>Math.max(0,(Number(b.slice(0,2))*60+Number(b.slice(3))-Number(a.slice(0,2))*60-Number(a.slice(3)))/60);
function scopedStoreKey(email:string,key:string){return `pm2_user_${encodeURIComponent(String(email||'guest').trim().toLowerCase())}_${key}`}
function readStoreFor<T>(email:string,key:string,fallback:T):T{
 try{
  const scoped=localStorage.getItem(scopedStoreKey(email,key));
  if(scoped)return JSON.parse(scoped) as T;
  const claimedKey=`pm2_legacy_claimed_${key}`;
  const legacy=localStorage.getItem(`pm2_${key}`);
  if(legacy&&!localStorage.getItem(claimedKey)&&email){
   let value:any=JSON.parse(legacy);
   if(key==='bookings'&&Array.isArray(value))value=value.filter((item:any)=>!item.ownerEmail||String(item.ownerEmail).trim().toLowerCase()===email).map((item:any)=>({...item,ownerEmail:item.ownerEmail||email}));
   localStorage.setItem(scopedStoreKey(email,key),JSON.stringify(value));
   localStorage.setItem(claimedKey,email);
   return value as T;
  }
  return fallback;
 }catch{return fallback}
}
function readStore<T>(key:string,fallback:T):T{
 let email='';try{const session=JSON.parse(localStorage.getItem('pm2_account_v2')||localStorage.getItem('pm2_account')||'null');email=String(session?.email||'').trim().toLowerCase()}catch{}
 return readStoreFor(email,key,fallback);
}
function writeStore<T>(key:string,value:T,email?:string){
 const owner=String(email||(()=>{try{return JSON.parse(localStorage.getItem('pm2_account_v2')||localStorage.getItem('pm2_account')||'null')?.email||''}catch{return ''}})()).trim().toLowerCase();
 if(!owner)return;
 try{localStorage.setItem(scopedStoreKey(owner,key),JSON.stringify(value))}catch{}
}
function loadSubscriptions(email?:string):any[]{
 const saved=readStoreFor<any[]>(email||readAccount()?.email||'','subscriptions',[]);
 return SUBSCRIPTION_PLANS.map(plan=>{
  const old=saved.find((item:any)=>item.planId===plan.id||item.id===plan.id||item.name===plan.name||(plan.id==='month'&&/30\s*дней/i.test(String(item.name||''))));
  const active=Boolean(old?.active);
  const startedAt=old?.startedAt||(active?new Date().toISOString():null);
  const expiresAt=old?.expiresAt||(active?new Date(Date.now()+plan.durationDays*86400000).toISOString():null);
  return {...plan,active:active&&(!expiresAt||Date.parse(expiresAt)>Date.now()),startedAt,expiresAt};
 });
}
function readAccount():any{try{const value=JSON.parse(localStorage.getItem('pm2_account_v2')||localStorage.getItem('pm2_account')||'null');if(!value||typeof value!=='object'||!value.email)return null;return {...value,email:String(value.email).trim().toLowerCase(),balance:Number(value.balance??3000),avatar:value.avatar||''}}catch{return null}}
function readUsers():any[]{
 try{
  const current=JSON.parse(localStorage.getItem('pm2_users_v2')||'[]');
  const legacy=JSON.parse(localStorage.getItem('pm2_users')||'[]');
  const merged=[...(Array.isArray(legacy)?legacy:[]),...(Array.isArray(current)?current:[])];
  const byEmail=new Map<string,any>();
  merged.forEach((u:any)=>{const key=String(u?.email||'').trim().toLowerCase();if(key)byEmail.set(key,{...(byEmail.get(key)||{}),...u,email:key})});
  const users=[...byEmail.values()];
  localStorage.setItem('pm2_users_v2',JSON.stringify(users));
  localStorage.setItem('pm2_users',JSON.stringify(users));
  return users;
 }catch{return []}
}
const parkingPhoto=(id:number)=>`/parking-photos/parking-${pad(((Math.abs(Number(id)||1)-1)%20)+1)}.jpg`;
const initials=(name:string)=>String(name||'Пользователь').trim().split(/\s+/).slice(0,2).map((part:string)=>part[0]||'').join('').toUpperCase()||'П';
function storeUser(user:any, previousEmail?:string){
 const emailKey=String(user?.email||'').trim().toLowerCase();
 if(!emailKey)return;
 const users=readUsers();
 const previous=String(previousEmail||'').trim().toLowerCase();
 const existing=users.find((u:any)=>u.email===emailKey)||users.find((u:any)=>u.email===previous)||{};
 const next=users.filter((u:any)=>u.email!==previous&&u.email!==emailKey);
 next.push({...existing,...user,email:emailKey});
 localStorage.setItem('pm2_users_v2',JSON.stringify(next));
 localStorage.setItem('pm2_users',JSON.stringify(next));
}

async function hashLocalPassword(password:string,saltHex?:string){
 const toHex=(bytes:Uint8Array)=>Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')).join('');
 const fromHex=(hex:string)=>new Uint8Array((hex.match(/.{1,2}/g)||[]).map(part=>parseInt(part,16)));
 const salt=saltHex?fromHex(saltHex):crypto.getRandomValues(new Uint8Array(16));
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:160000,hash:'SHA-256'},key,256);
 return {passwordSalt:toHex(salt),passwordHash:toHex(new Uint8Array(bits))};
}
async function verifyLocalPassword(password:string,user:any){
 if(user?.passwordHash&&user?.passwordSalt){const check=await hashLocalPassword(password,user.passwordSalt);return check.passwordHash===user.passwordHash}
 // Legacy v13 demo users are migrated to PBKDF2 on their next successful login.
 return typeof user?.password==='string'&&user.password===password;
}


export default function App(){
 const [screen,setScreen]=useState<Screen>('Главная');
 const [account,setAccount]=useState<any>(()=>readAccount());
 const [cloudStateReady,setCloudStateReady]=useState(false);
 const [authMode,setAuthMode]=useState<'login'|'register'>(()=>readUsers().length?'login':'register');
 const [authForm,setAuthForm]=useState({name:'',email:'',password:'',phone:''});
 const [authError,setAuthError]=useState('');
 const [spots,setSpots]=useState<Spot[]>(()=>readParkingSpotsForLot(12));
 const [bookings,setBookings]=useState<Booking[]>(()=>readStore('bookings',seedBookings));
 const [vehicles,setVehicles]=useState<Vehicle[]>(()=>readStore<Vehicle[]>('vehicles',seedVehicles).map(v=>({...v,tagId:v.tagId||vehicleChipId(v),chipEnabled:v.chipEnabled!==false})));
 const [notices,setNotices]=useState<Notice[]>(()=>readStore('notices',[]));
 const [favorites,setFavorites]=useState<string[]>(()=>readStore('favorites',[]));
 const [subscriptions,setSubscriptions]=useState<any[]>(()=>loadSubscriptions());
 const [parkingName,setParkingName]=useState('Парковка Центр');
 const [address,setAddress]=useState('Москва, ул. Примерная, 12');
 const [tariff,setTariff]=useState(200);
 const [selectedLotId,setSelectedLotId]=useState(12);
 const [parkingCatalog,setParkingCatalog]=useState<any[]>(MOSCOW_PARKINGS);
 const [profileName,setProfileName]=useState(()=>readAccount()?.name||'');
 const [email,setEmail]=useState(()=>readAccount()?.email||'');
 const [phone,setPhone]=useState(()=>readAccount()?.phone||'');
 const [avatar,setAvatar]=useState<string>(()=>readAccount()?.avatar||'');
 const [walletBalance,setWalletBalance]=useState<number>(()=>Number(readAccount()?.balance??3000));
 const [paymentMethods,setPaymentMethods]=useState<PaymentMethod[]>(()=>readStore('payment_methods',[]));
 const [topUpAmount,setTopUpAmount]=useState('1000');
 const [topUpChannel,setTopUpChannel]=useState<'card'|'sbp'>('sbp');
 const [draftCard,setDraftCard]=useState({holder:'',number:'',expiry:''});
 const [draftSbp,setDraftSbp]=useState({phone:'',bank:'Тестовый банк'});
 const [notificationsEnabled,setNotificationsEnabled]=useState<boolean>(()=>readStore('notifications_enabled',true));
 const [supportMessages,setSupportMessages]=useState<any[]>([{id:1,role:'assistant',text:'Здравствуйте! Я помощник Parking Manager. Напишите вопрос о парковках, бронировании, оплате, QR-пропуске или настройках.'}]);
 const [supportDraft,setSupportDraft]=useState('');
 const [supportBusy,setSupportBusy]=useState(false);
 const [query,setQuery]=useState(''); const [filter,setFilter]=useState('Все'); const [zone,setZone]=useState('A');
 const [selectedSpot,setSelectedSpot]=useState<number|null>(null);
 const [date,setDate]=useState(todayISO()); const [start,setStart]=useState('14:00'); const [end,setEnd]=useState('16:00');
 const [vehicleId,setVehicleId]=useState(1); const [promo,setPromo]=useState(''); const [promoApplied,setPromoApplied]=useState(false);
 const [modal,setModal]=useState(''); const [modalData,setModalData]=useState<any>(null); const [toast,setToast]=useState('');
 const [payments,setPayments]=useState<PaymentRecord[]>(()=>readStore('payments',[]));
 const [mobileMenu,setMobileMenu]=useState(false); const [showNotifications,setShowNotifications]=useState(false);
 const [draftVehicle,setDraftVehicle]=useState({plate:'',make:'',model:'',color:'',photo:''});
 const [draftName,setDraftName]=useState(profileName); const [draftEmail,setDraftEmail]=useState(email); const [draftPhone,setDraftPhone]=useState(phone);
 const [extendEnd,setExtendEnd]=useState('18:00');
 const paymentGuardRef=useRef(new Set<string>());
 const transitionGuardRef=useRef(new Set<string>());

 function activateLocalAccount(session:any){
  localStorage.setItem('pm2_account',JSON.stringify(session));
  localStorage.setItem('pm2_account_v2',JSON.stringify(session));
  setCloudStateReady(!session.supabaseAuth);setAccount(session);setProfileName(session.name||'');setEmail(String(session.email||'').toLowerCase());setPhone(session.phone||'');setAvatar(session.avatar||'');setWalletBalance(Number(session.balance??3000));
  const owner=String(session.email||'').trim().toLowerCase();
  setBookings(readStoreFor<Booking[]>(owner,'bookings',seedBookings).map(b=>({...b,ownerEmail:b.ownerEmail||owner})));
  setVehicles(readStoreFor<Vehicle[]>(owner,'vehicles',seedVehicles).map(v=>({...v,tagId:v.tagId||vehicleChipId(v),chipEnabled:v.chipEnabled!==false})));
  setNotices(readStoreFor<Notice[]>(owner,'notices',[]));setFavorites(readStoreFor<string[]>(owner,'favorites',[]));
  setSubscriptions(loadSubscriptions(owner));setPayments(readStoreFor<PaymentRecord[]>(owner,'payments',[]));
  setPaymentMethods(readStoreFor<PaymentMethod[]>(owner,'payment_methods',[]));setNotificationsEnabled(readStoreFor<boolean>(owner,'notifications_enabled',true));
  setScreen('Главная');
 }

 useEffect(()=>{localStorage.setItem('pm2_spots',JSON.stringify(spots));const lotId=spots[0]?.parkingId;if(lotId)try{localStorage.setItem(`pm2_spots_lot_${lotId}`,JSON.stringify(spots))}catch{}},[spots]);
 useEffect(()=>{writeStore('bookings',bookings,email)},[bookings,email]);
 useEffect(()=>{writeStore('vehicles',vehicles,email)},[vehicles,email]);
 useEffect(()=>{writeStore('notices',notices,email)},[notices,email]);
 useEffect(()=>{writeStore('favorites',favorites,email)},[favorites,email]);
 useEffect(()=>{writeStore('subscriptions',subscriptions,email)},[subscriptions,email]);
 useEffect(()=>{writeStore('payments',payments,email)},[payments,email]);
 useEffect(()=>{writeStore('payment_methods',paymentMethods,email)},[paymentMethods,email]);
 useEffect(()=>{writeStore('notifications_enabled',notificationsEnabled,email)},[notificationsEnabled,email]);
 useEffect(()=>{
  if(!account?.supabaseAuth||!cloudStateReady||!supabase)return;
  const userId=String(account.id);
  const rows=[
   {user_id:userId,state_key:'bookings',payload:bookings},
   {user_id:userId,state_key:'vehicles',payload:vehicles},
   {user_id:userId,state_key:'notices',payload:notices},
   {user_id:userId,state_key:'favorites',payload:favorites},
   {user_id:userId,state_key:'subscriptions',payload:subscriptions},
   {user_id:userId,state_key:'payments',payload:payments},
   {user_id:userId,state_key:'payment_methods',payload:paymentMethods},
   {user_id:userId,state_key:'notifications_enabled',payload:notificationsEnabled},
   {user_id:userId,state_key:'wallet_balance',payload:walletBalance},
   {user_id:userId,state_key:'avatar',payload:avatar}
  ];
  const timer=window.setTimeout(()=>{void supabase.from('user_app_state').upsert(rows,{onConflict:'user_id,state_key'}).then(({error}:any)=>{if(error){console.error('Supabase app-state sync:',error.message);setToast(`Облачная синхронизация: ${error.message}`)}})},450);
  return ()=>window.clearTimeout(timer);
 },[account?.id,account?.supabaseAuth,cloudStateReady,bookings,vehicles,notices,favorites,subscriptions,payments,paymentMethods,notificationsEnabled,walletBalance,avatar]);
 useEffect(()=>{if(!account?.email)return;const session={...account,name:profileName||account.name,email:email||account.email,phone,avatar,balance:walletBalance};try{localStorage.setItem('pm2_account',JSON.stringify(session));localStorage.setItem('pm2_account_v2',JSON.stringify(session));if(!account.supabaseAuth)storeUser(session,account.email);}catch{}},[account?.email,profileName,email,phone,avatar,walletBalance]);
 // Автоматически закрываем неоплаченные удержания, пропущенные окна въезда и завершённые сессии.
 useEffect(()=>{
  if(!account?.email)return;
  const tick=()=>{
   const now=Date.now();const nowIso=new Date().toISOString();const expiredBookings:Booking[]=[];const completedBookings:Booking[]=[];
   const next=bookings.map(b=>{
    if(b.status==='Ожидает оплаты'&&b.createdAt&&now-Date.parse(b.createdAt)>10*60*1000){expiredBookings.push(b);return {...b,status:'Отменено' as BookingStatus,payment:'Срок оплаты истёк'};}
    if(b.status==='Подтверждено'&&!b.entrySimulated&&Date.parse(`${b.date}T${b.end}:00`)<=now){expiredBookings.push(b);const paid=b.payment.startsWith('Оплачено')&&!b.refundedAt;return {...b,status:'Отменено' as BookingStatus,payment:paid?'Возвращено на внутренний баланс':'Время бронирования истекло',refundedAt:paid?nowIso:b.refundedAt};}
    if(b.status==='Активно'&&b.entrySimulated&&Date.parse(`${b.date}T${b.end}:00`)<=now){completedBookings.push(b);return {...b,status:'Завершено' as BookingStatus,exitTime:b.exitTime||nowIso};}
    return b;
   });
   if(expiredBookings.length||completedBookings.length){
    setBookings(next);
    const refundTotal=expiredBookings.filter(b=>b.payment.startsWith('Оплачено')&&!b.refundedAt).reduce((n,b)=>n+Number(b.amount||0),0);
    if(refundTotal>0){setWalletBalance(prev=>prev+refundTotal);setAccount((prev:any)=>prev?({...prev,balance:Number(prev.balance||0)+refundTotal}):prev);setPayments(prev=>prev.map(p=>expiredBookings.some(b=>b.id===p.bookingId)&&p.status==='Успешно'?{...p,status:'Возвращён' as const}:p).concat(expiredBookings.filter(b=>b.payment.startsWith('Оплачено')&&!b.refundedAt).map(b=>({id:`REF-${Date.now()}-${b.id}`,bookingId:b.id,amount:b.amount,method:'Автоматический возврат на внутренний баланс',status:'Возвращён' as const,createdAt:nowIso,receiptNo:`PM-REF-${b.id}`}))));}
    [...expiredBookings,...completedBookings].forEach(b=>{
     const lotId=Number(b.parkingId||-1);const other=bookings.some(x=>x.id!==b.id&&x.spot===b.spot&&Number(x.parkingId||-1)===lotId&&x.date===b.date&&!['Отменено','Завершено'].includes(x.status)&&x.start<b.end&&x.end>b.start);
     if(!other)updateLotSpotStatus(lotId,b.spot,'Свободно');
    });
    expiredBookings.forEach(b=>addNotice('Бронирование закрыто',`Бронь ${b.id} истекла. ${b.payment.startsWith('Оплачено')?'Средства возвращены на внутренний баланс.':'Место освобождено.'}`));
    completedBookings.forEach(b=>addNotice('Парковка завершена',`Время бронирования ${b.id} закончилось. Сессия автоматически закрыта.`));
   }
   // Напоминание за 30 минут до начала бронирования.
   const reminders=bookings.filter(b=>b.status==='Подтверждено'&&!b.reminderSent&&b.date===todayISO());
   reminders.forEach(b=>{const minutes=Date.parse(`${b.date}T${b.start}:00`)-now;if(minutes>0&&minutes<=30*60*1000){setBookings(prev=>prev.map(x=>x.id===b.id?{...x,reminderSent:true}:x));addNotice('Скоро начнётся парковка',`До начала бронирования ${b.id} осталось около ${Math.ceil(minutes/60000)} мин.`);if(typeof Notification!=='undefined'&&Notification.permission==='granted')new Notification('Parking Manager',{body:`До начала бронирования ${b.id} осталось около ${Math.ceil(minutes/60000)} мин.`});}});
  };
  tick();const timer=window.setInterval(tick,30000);return()=>window.clearInterval(timer);
 },[account?.email,bookings,notificationsEnabled]);
 async function restoreSupabaseUser(user:any){
  if(!supabase||!user)return;
  const [{data:profile},{data:wallet},{data:appRows}] = await Promise.all([
   supabase.from('profiles').select('full_name,phone,avatar_url').eq('id',user.id).maybeSingle(),
   supabase.from('wallet_accounts').select('balance').eq('user_id',user.id).maybeSingle(),
   supabase.from('user_app_state').select('state_key,payload').eq('user_id',user.id)
  ]);
  if(!profile){await supabase.from('profiles').upsert({id:user.id,full_name:String(user.user_metadata?.full_name||user.email||'Пользователь'),phone:String(user.user_metadata?.phone||'')})}
  const remote=new Map<string,any>((appRows||[]).map((row:any)=>[row.state_key,row.payload]));
  const session={id:user.id,name:profile?.full_name||String(user.user_metadata?.full_name||user.email||'Пользователь'),email:String(user.email||'').toLowerCase(),phone:profile?.phone||user.user_metadata?.phone||'',avatar:profile?.avatar_url||'',balance:Number(remote.get('wallet_balance')??wallet?.balance??3000),supabaseAuth:true};
  activateLocalAccount(session);
  const owner=String(session.email);
  if(remote.has('bookings'))setBookings((remote.get('bookings')||[]).map((b:any)=>({...b,ownerEmail:owner})));
  if(remote.has('vehicles'))setVehicles((remote.get('vehicles')||[]).map((v:any)=>({...v,tagId:v.tagId||vehicleChipId(v),chipEnabled:v.chipEnabled!==false})));
  if(remote.has('notices'))setNotices(remote.get('notices')||[]);
  if(remote.has('favorites'))setFavorites(remote.get('favorites')||[]);
  if(remote.has('subscriptions'))setSubscriptions(remote.get('subscriptions')||loadSubscriptions(owner));
  if(remote.has('payments'))setPayments(remote.get('payments')||[]);
  if(remote.has('payment_methods'))setPaymentMethods(remote.get('payment_methods')||[]);
  if(remote.has('notifications_enabled'))setNotificationsEnabled(Boolean(remote.get('notifications_enabled')));
  if(remote.has('wallet_balance'))setWalletBalance(Number(remote.get('wallet_balance')));
  if(remote.has('avatar')){setAvatar(String(remote.get('avatar')||''));setAccount((prev:any)=>prev?({...prev,avatar:String(remote.get('avatar')||'')}):prev)}
  setCloudStateReady(true);
 }
 useEffect(()=>{
  if(!isSupabaseConfigured||!supabase)return;
  let alive=true;
  supabase.auth.getSession().then(({data,error})=>{
   if(!alive)return;
   if(error){setAuthError(error.message);return;}
   if(data.session?.user)void restoreSupabaseUser(data.session.user);
   else setAccount(null);
  });
  const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{
   if(!alive)return;
   if(session?.user){window.setTimeout(()=>{if(alive)void restoreSupabaseUser(session.user)},0)}
   else {setAccount(null);setScreen('Главная')}
  });
  return ()=>{alive=false;subscription.unsubscribe()};
 },[]);
 // Защита от старых внешних ссылок на картографические сайты.
 // Все действия с парковками должны оставаться внутри Parking Manager.
 useEffect(()=>{
  const isExternalMapUrl=(value:string)=>/(openstreetmap\.org|\bosm\.org|maps\.google\.|google\.[^/]+\/maps|yandex\.(ru|com)\/maps)/i.test(value);
  const blockedMessage='Внешняя карта отключена. Используйте карту внутри Parking Manager.';
  const handleDocumentClick=(event:MouseEvent)=>{
   const target=event.target;
   const anchor=target instanceof Element?target.closest('a[href]') as HTMLAnchorElement|null:null;
   const href=anchor?.href||anchor?.getAttribute('href')||'';
   if(anchor&&isExternalMapUrl(href)){
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    setScreen('Парковки');setToast(blockedMessage);
   }
  };
  document.addEventListener('click',handleDocumentClick,true);
  const originalOpen=window.open;
  window.open=((url?:string|URL,target?:string,features?:string)=>{
   const destination=url==null?'':String(url);
   if(isExternalMapUrl(destination)){
    setScreen('Парковки');setToast(blockedMessage);return null;
   }
   return originalOpen.call(window,url as string|undefined,target,features);
  }) as typeof window.open;
  document.title='Parking Manager v17 — спутниковая карта и мобильная навигация';
  return ()=>{document.removeEventListener('click',handleDocumentClick,true);window.open=originalOpen;};
 },[]);
 const free=spots.filter(s=>s.status==='Свободно').length, occupied=spots.filter(s=>s.status==='Занято').length, reserved=spots.filter(s=>s.status==='Забронировано').length;
 const myBookings=useMemo(()=>bookings.filter(b=>b.ownerEmail?b.ownerEmail===String(email).toLowerCase():b.person===profileName),[bookings,email,profileName]);
 const revenue=myBookings.filter(b=>b.payment.startsWith('Оплачено')).reduce((n,b)=>n+b.amount,0);
 const filteredBookings=useMemo(()=>myBookings.filter(b=>`${b.id} ${b.person} ${b.car} ${b.spot}`.toLowerCase().includes(query.toLowerCase())&&(filter==='Все'||b.status===filter)),[myBookings,query,filter]);
 const visiblePayments=useMemo(()=>payments.filter(p=>myBookings.some(b=>b.id===p.bookingId)),[payments,myBookings]);
 const activeSubscription=subscriptions.find((item:any)=>item.active&&(!item.expiresAt||Date.parse(item.expiresAt)>Date.now()));
 const subscriptionDiscount=Number(activeSubscription?.discountPct||0);
 const selected=spots.find(s=>s.id===selectedSpot);
 const hours=hoursBetween(start,end); const promoDiscount=promoApplied?0.1:0; const effectiveDiscount=1-(1-promoDiscount)*(1-subscriptionDiscount/100); const total=selected?Math.round(hours*tariff*(1-effectiveDiscount)):0;
 function notify(message:string){setToast(message);window.setTimeout(()=>setToast(''),2600)}
 function go(s:Screen){setScreen(s);setMobileMenu(false);setShowNotifications(false)}
 function addNotice(title:string,text:string){if(!notificationsEnabled)return;setNotices(n=>[{id:Date.now(),title,text,time:new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}),read:false},...n])}
 function available(s:Spot){return s.status==='Свободно'}
 function overlaps(spot:string,day:string,a:string,b:string,parkingId:number=selectedLotId){return bookings.some(x=>x.spot===spot&&x.date===day&&Number(x.parkingId||-1)===Number(parkingId)&&!['Отменено','Завершено'].includes(x.status)&&a<x.end&&b>x.start)}
 function updateLotSpotStatus(parkingId:number|undefined,spot:string,status:SpotStatus){
  const lotId=Number(parkingId||selectedLotId);
  const updated=readParkingSpotsForLot(lotId).map(s=>spotName(s)===spot?{...s,status}:s);
  try{localStorage.setItem(`pm2_spots_lot_${lotId}`,JSON.stringify(updated))}catch{}
  if(Number(spots[0]?.parkingId||selectedLotId)===lotId)setSpots(updated);
 }
 function createBooking(){
  if(!selected){notify('Выберите свободное место');return} if(!date||date<todayISO()){notify('Выберите сегодняшнюю или будущую дату');return} if(end<=start){notify('Время окончания должно быть позже начала');return} if(selected.status!=='Свободно'){notify('Это место сейчас недоступно. Выберите другое.');return}
  const sn=spotName(selected); if(overlaps(sn,date,start,end,selectedLotId)){notify('На это время место уже забронировано. Выберите другой интервал.');return}
  const vehicle=vehicles.find(v=>v.id===vehicleId); const id=`PM-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
  const b:Booking={id,person:profileName,ownerEmail:email.toLowerCase(),car:vehicle?.plate||'Не указан',spot:sn,parkingId:selectedLotId,parkingName:parkingName,parkingAddress:address,date,start,end,amount:total,hourlyRate:tariff,subscriptionDiscountPct:subscriptionDiscount,createdAt:new Date().toISOString(),status:'Ожидает оплаты',payment:'Ожидает оплаты с баланса',pass:`${id}-ACCESS`};
  setBookings(prev=>[b,...prev]);updateLotSpotStatus(selectedLotId,sn,'Забронировано');setModal('payment');setModalData(b);notify('Место удерживается 10 минут. Оплатите бронирование с внутреннего баланса.');
 }
 function topUpWallet(amount:number){
  const add=Math.max(0,Math.round(amount));if(!add)return;
  const next=walletBalance+add;setWalletBalance(next);setAccount((prev:any)=>({...prev,balance:next}));
  try{const session={...account,balance:next};localStorage.setItem('pm2_account',JSON.stringify(session));localStorage.setItem('pm2_account_v2',JSON.stringify(session));if(!account?.supabaseAuth)storeUser({...account,email,name:profileName,phone,avatar,balance:next},email);}catch{}
  notify(`Баланс пополнен на ${money(add)}. Это демонстрационные средства проекта.`);
 }
 function openTopUp(){setTopUpAmount('1000');setTopUpChannel(paymentMethods.some(m=>m.kind==='sbp')?'sbp':'card');setModal('topup')}
 function bindVirtualCard(){
  const digits=draftCard.number.replace(/\D/g,'');
  if(!draftCard.holder.trim()||digits.length!==16||!/^\d{2}\/\d{2}$/.test(draftCard.expiry)){notify('Для виртуальной привязки укажите имя, 16 цифр тестового номера и срок ММ/ГГ');return}
  const method:PaymentMethod={id:`CARD-${Date.now()}`,kind:'card',label:`Карта •• ${digits.slice(-4)}`,details:`${draftCard.holder.trim()} · до ${draftCard.expiry}`};
  setPaymentMethods(prev=>[...prev.filter(m=>m.kind!=='card'),method]);setDraftCard({holder:'',number:'',expiry:''});setTopUpChannel('card');setModal('topup');notify('Виртуальная карта привязана. Реальные реквизиты не проверяются.');
 }
 function bindVirtualSbp(){
  const digits=draftSbp.phone.replace(/\D/g,'');if(digits.length<10){notify('Укажите тестовый номер телефона для СБП');return}
  const method:PaymentMethod={id:`SBP-${Date.now()}`,kind:'sbp',label:'СБП · '+digits.slice(-4),details:`${draftSbp.bank} · телефон •• ${digits.slice(-4)}`};
  setPaymentMethods(prev=>[...prev.filter(m=>m.kind!=='sbp'),method]);setDraftSbp({phone:'',bank:'Тестовый банк'});setTopUpChannel('sbp');setModal('topup');notify('Виртуальный профиль СБП привязан. Реальный банк не подключён.');
 }
 function confirmTopUp(){const amount=Math.round(Number(topUpAmount));if(!Number.isFinite(amount)||amount<100||amount>100000){notify('Введите сумму от 100 до 100 000 ₽');return}const method=paymentMethods.find(m=>m.kind===topUpChannel);if(!method){setModal(topUpChannel==='card'?'bindCard':'bindSbp');return}setModal('');topUpWallet(amount);addNotice('Баланс пополнен',`Демо-пополнение на ${money(amount)} через ${topUpChannel==='sbp'?'СБП':'банковскую карту'}.`)}
 function subscribeToPlan(planId:string){
  const plan=SUBSCRIPTION_PLANS.find(item=>item.id===planId);if(!plan)return;
  const current=subscriptions.find((item:any)=>item.active&&(!item.expiresAt||Date.parse(item.expiresAt)>Date.now()));
  if(current&&current.id!==planId){notify(`Сначала завершите действующий абонемент «${current.name}».`);return}
  if(walletBalance<plan.price){setTopUpAmount(String(Math.max(100,plan.price-walletBalance)));setTopUpChannel(paymentMethods.some(m=>m.kind==='sbp')?'sbp':'card');setModal('topup');notify(`Для подключения не хватает ${money(plan.price-walletBalance)}. Пополните баланс и повторите.`);return}
  const now=Date.now();const renewalBase=current?.id===planId&&current.expiresAt?Math.max(now,Date.parse(current.expiresAt)):now;const started=new Date(now);const expires=new Date(renewalBase+plan.durationDays*86400000);const nextBalance=walletBalance-plan.price;
  setWalletBalance(nextBalance);setAccount((prev:any)=>prev?({...prev,balance:nextBalance}):prev);
  try{const session={...account,balance:nextBalance};localStorage.setItem('pm2_account',JSON.stringify(session));localStorage.setItem('pm2_account_v2',JSON.stringify(session));if(!account?.supabaseAuth)storeUser({...account,email,name:profileName,phone,avatar,balance:nextBalance},email)}catch{}
  setSubscriptions(SUBSCRIPTION_PLANS.map(item=>({...item,active:item.id===planId,startedAt:item.id===planId?(current?.id===planId&&current.startedAt?current.startedAt:started.toISOString()):null,expiresAt:item.id===planId?expires.toISOString():null})));
  setModal('');const action=current?.id===planId?'Абонемент продлён':'Абонемент подключён';addNotice(action,`${plan.name} действует до ${expires.toLocaleDateString('ru-RU')}. Скидка ${plan.discountPct}% применяется к бронированиям.`);notify(`${action}: «${plan.name}». Списано ${money(plan.price)} с внутреннего баланса.`);
 }
 function cancelSubscription(planId:string){
  const plan=subscriptions.find((item:any)=>item.id===planId);if(!plan?.active)return;
  setSubscriptions(prev=>prev.map((item:any)=>item.id===planId?{...item,active:false,expiresAt:null,startedAt:null}:item));
  notify(`Абонемент «${plan.name}» отключён. Возврат за неиспользованный период не предусмотрен в демо-версии.`);
 }
 async function sendSupportMessage(){
  const question=supportDraft.trim();if(!question||supportBusy)return;
  setSupportDraft('');setSupportMessages(prev=>[...prev,{id:Date.now(),role:'user',text:question}]);setSupportBusy(true);
  let answer=buildSupportReply(question);
  const endpoint=(import.meta as any).env?.VITE_AI_SUPPORT_ENDPOINT;
  if(endpoint){
   try{
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:question,history:supportMessages})});
    if(response.ok){const data=await response.json();answer=String(data.reply||data.answer||answer)}
   }catch{answer+='\n\nНе удалось связаться с подключённым ИИ-сервисом, поэтому я ответил по встроенной инструкции.'}
  }
  setSupportMessages(prev=>[...prev,{id:Date.now()+1,role:'assistant',text:answer}]);setSupportBusy(false);
 }

 function payBooking(){
  if(!modalData)return;const booking=modalData as Booking;
  if(paymentGuardRef.current.has(booking.id)){notify('Платёж по этому бронированию уже обрабатывается или выполнен.');return}
  const latest=bookings.find(item=>item.id===booking.id);if(!latest||latest.status!=='Ожидает оплаты'||payments.some(item=>item.bookingId===booking.id&&item.status==='Успешно')){notify('Это бронирование уже оплачено, отменено или недоступно.');setModal('');return}
  if(walletBalance<latest.amount){notify(`Не хватает ${money(latest.amount-walletBalance)}. Пополните внутренний баланс.`);return}
  paymentGuardRef.current.add(booking.id);
  const nextBalance=walletBalance-latest.amount;setWalletBalance(nextBalance);
  const record:PaymentRecord={id:`PAY-${Date.now().toString().slice(-8)}`,bookingId:booking.id,amount:latest.amount,method:'Внутренний баланс Parking Manager',status:'Успешно',createdAt:new Date().toISOString(),receiptNo:`PM-R-${Date.now().toString().slice(-7)}`};
  setAccount((prev:any)=>({...prev,balance:nextBalance}));
  try{const session={...account,balance:nextBalance};localStorage.setItem('pm2_account',JSON.stringify(session));localStorage.setItem('pm2_account_v2',JSON.stringify(session));if(!account?.supabaseAuth)storeUser({...account,email,name:profileName,phone,avatar,balance:nextBalance},email);}catch{}
  setPayments(prev=>[record,...prev]);setBookings(prev=>prev.map(b=>b.id===booking.id?{...b,status:'Подтверждено',payment:'Оплачено с внутреннего баланса'}:b));
  updateLotSpotStatus(booking.parkingId,booking.spot,'Забронировано');addNotice('Оплата прошла успешно',`Бронирование ${booking.id} оплачено с внутреннего баланса. Чек ${record.receiptNo}.`);
  setModal('paymentSuccess');setModalData({booking:latest,record});
 }
 function downloadReceipt(record:PaymentRecord){
  const booking=bookings.find(b=>b.id===record.bookingId);
  const lines=['PARKING MANAGER — ДЕМОНСТРАЦИОННЫЙ ЧЕК','----------------------------------------',`Чек: ${record.receiptNo}`,`Платёж: ${record.id}`,`Бронирование: ${record.bookingId}`,`Место: ${booking?.spot||'—'}`,`Дата парковки: ${booking?.date||'—'}`,`Период: ${booking?`${booking.start}–${booking.end}`:'—'}`,`Способ оплаты: ${record.method}`,`Сумма: ${money(record.amount)}`,`Статус: ${record.status}`,`Дата операции: ${new Date(record.createdAt).toLocaleString('ru-RU')}`,'','Учебный документ. Списан только демонстрационный баланс; реальные деньги не списывались.'];
  const blob=new Blob([lines.join('\n')],{type:'text/plain;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`receipt-${record.receiptNo||record.id}.txt`;a.click();URL.revokeObjectURL(url);
 }
 function cancelBooking(id:string){
  const guardKey=`cancel:${id}`;if(transitionGuardRef.current.has(guardKey))return;
  const b=bookings.find(x=>x.id===id);if(!b)return;
  if(b.status==='Активно'){notify('Автомобиль уже въехал. Сначала зарегистрируйте выезд.');return}
  if(['Отменено','Завершено'].includes(b.status)){notify('Это бронирование уже закрыто.');return}
  transitionGuardRef.current.add(guardKey);
  const wasPaid=b.payment.startsWith('Оплачено')&&!b.refundedAt;
  let refund=0;
  if(wasPaid){refund=Number(b.amount)||0;const nextBalance=walletBalance+refund;setWalletBalance(nextBalance);setAccount((prev:any)=>prev?({...prev,balance:nextBalance}):prev);try{const session={...account,balance:nextBalance};localStorage.setItem('pm2_account',JSON.stringify(session));localStorage.setItem('pm2_account_v2',JSON.stringify(session));if(!account?.supabaseAuth)storeUser({...account,email,name:profileName,phone,avatar,balance:nextBalance},email);}catch{}
   const original=payments.find(p=>p.bookingId===id&&p.status==='Успешно');
   setPayments(prev=>prev.map(p=>p.bookingId===id&&p.status==='Успешно'?{...p,status:'Возвращён' as const}:p).concat([{id:`REF-${Date.now().toString().slice(-8)}`,bookingId:id,amount:refund,method:'Возврат на внутренний баланс',status:'Возвращён',createdAt:new Date().toISOString(),receiptNo:`PM-REF-${Date.now().toString().slice(-7)}`,relatedPaymentId:original?.id}]));
  }
  setBookings(prev=>prev.map(x=>x.id===id?{...x,status:'Отменено' as BookingStatus,payment:wasPaid?'Возвращено на внутренний баланс':x.payment,refundedAt:wasPaid?new Date().toISOString():x.refundedAt}:x));
  const lotId=Number(b.parkingId||selectedLotId);
  const other=bookings.some(x=>x.id!==id&&x.spot===b.spot&&Number(x.parkingId||-1)===lotId&&x.date===b.date&&!['Отменено','Завершено'].includes(x.status)&&x.start<b.end&&x.end>b.start);
  if(!other)updateLotSpotStatus(lotId,b.spot,'Свободно');
  if(refund)addNotice('Возврат выполнен',`${money(refund)} возвращено на внутренний баланс за бронь ${id}.`);
  setModal('');setModalData(null);notify(wasPaid?`Бронирование отменено. Возвращено ${money(refund)} на баланс.`:'Бронирование отменено. Место освобождено.');
  transitionGuardRef.current.delete(guardKey);
 }
 function extendSession(){
  if(!modalData)return;const b=modalData as Booking;
  if(!['Подтверждено','Активно'].includes(b.status)){notify('Продлевать можно только оплаченное бронирование.');return}
  if(extendEnd<=b.end){notify('Новое время должно быть позже текущего');return}
  if(overlaps(b.spot,b.date,b.end,extendEnd,Number(b.parkingId||selectedLotId))){notify('Следующее бронирование не позволяет продлить сессию');return}
  const hourly=Number(b.hourlyRate||tariff);const lockedDiscount=Number(b.subscriptionDiscountPct??subscriptionDiscount);const add=Math.round(hoursBetween(b.end,extendEnd)*hourly*(1-lockedDiscount/100));
  if(add<=0){notify('Проверьте время продления');return}
  if(walletBalance<add){notify(`Для продления не хватает ${money(add-walletBalance)}. Пополните баланс.`);return}
  const nextBalance=walletBalance-add;setWalletBalance(nextBalance);setAccount((prev:any)=>prev?({...prev,balance:nextBalance}):prev);
  try{const session={...account,balance:nextBalance};localStorage.setItem('pm2_account',JSON.stringify(session));localStorage.setItem('pm2_account_v2',JSON.stringify(session));if(!account?.supabaseAuth)storeUser({...account,email,name:profileName,phone,avatar,balance:nextBalance},email);}catch{}
  const record:PaymentRecord={id:`PAY-${Date.now().toString().slice(-8)}`,bookingId:b.id,amount:add,method:'Внутренний баланс · продление',status:'Успешно',createdAt:new Date().toISOString(),receiptNo:`PM-R-${Date.now().toString().slice(-7)}`};setPayments(prev=>[record,...prev]);
  setBookings(prev=>prev.map(x=>x.id===b.id?{...x,end:extendEnd,amount:x.amount+add}:x));addNotice('Время парковки продлено',`Бронирование ${b.id} продлено до ${extendEnd}. Списано ${money(add)}.`);setModal('');notify(`Продление оплачено. Списано ${money(add)}.`)
 }
 function exportCSV(){const rows=[['Бронь','Клиент','Автомобиль','Место','Дата','Начало','Окончание','Сумма','Статус','Оплата'],...filteredBookings.map(b=>[b.id,b.person,b.car,b.spot,b.date,b.start,b.end,String(b.amount),b.status,b.payment])];const csv='\uFEFF'+rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(';')).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='parking-manager-report.csv';a.click();URL.revokeObjectURL(a.href);notify('Отчёт CSV сохранён')}
 function applyPromo(){if(promo.trim().toUpperCase()==='PARK10'){setPromoApplied(true);notify('Промокод применён: скидка 10%')}else notify('Промокод не найден или недействителен')}
 function openPass(b:Booking){if(b.entrySimulated){notify('Этот QR уже использован при имитации въезда. Повторный показ недоступен.');return}if(!['Подтверждено','Активно'].includes(b.status)){notify('QR-пропуск доступен только после подтверждения бронирования');return}setModal('pass');setModalData(b);addNotice('Открыт пропуск',`Просмотрен пропуск для ${b.id}.`)}
 function simulateEntry(){const b=modalData as Booking|null;if(!b)return;if(b.entrySimulated){setModal('');notify('Этот пропуск уже использован');return}if(b.status!=='Подтверждено'){notify('Для въезда требуется подтверждённое и оплаченное бронирование.');return}const now=new Date();if(b.date!==todayISO()){notify('Въезд по этому пропуску разрешён только в дату бронирования.');return}const current=now.getHours()*60+now.getMinutes(),from=Number(b.start.slice(0,2))*60+Number(b.start.slice(3)),until=Number(b.end.slice(0,2))*60+Number(b.end.slice(3));if(current<from-15||current>until){notify(`Время въезда ограничено интервалом ${b.start}–${b.end} (допуск 15 минут до начала).`);return}const enteredAt=now.toISOString();setBookings(prev=>prev.map(item=>item.id===b.id?{...item,status:'Активно',entrySimulated:true,entryTime:enteredAt}:item));updateLotSpotStatus(b.parkingId,b.spot,'Занято');setModal('');setModalData(null);addNotice('Въезд зарегистрирован',`Въезд по бронированию ${b.id} отмечен в ${now.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}. QR-пропуск использован.`);notify('Въезд отмечен. QR-пропуск использован и больше не откроется.')}
 function simulateVehicleChipEntry(){
  const vehicle=vehicles.find(v=>v.id===vehicleId);
  if(!vehicle){notify('Сначала добавьте автомобиль в профиле');return}
  if(vehicle.chipEnabled===false){notify('Виртуальный чип автомобиля выключен. Включите его в профиле.');return}
  const activeSession=bookings.find(b=>b.car===vehicle.plate&&b.ownerEmail?.toLowerCase()===email.toLowerCase()&&Number(b.parkingId||-1)===Number(selectedLotId)&&b.status==='Активно'&&b.entrySimulated&&!b.exitTime);
  if(activeSession){simulateExit(activeSession.id);notify(`Чип ${vehicle.tagId} распознан. Выезд зарегистрирован для ${vehicle.plate}.`);return}
  const booking=bookings.find(b=>b.car===vehicle.plate&&b.ownerEmail?.toLowerCase()===email.toLowerCase()&&Number(b.parkingId||-1)===Number(selectedLotId)&&b.date===todayISO()&&b.status==='Подтверждено'&&!b.entrySimulated);
  if(!booking){notify('Шлагбаум не открылся: нет оплаченной брони для этого автомобиля на выбранной парковке сегодня.');return}
  const now=new Date();const currentMinutes=now.getHours()*60+now.getMinutes();const startMinutes=Number(booking.start.slice(0,2))*60+Number(booking.start.slice(3));const endMinutes=Number(booking.end.slice(0,2))*60+Number(booking.end.slice(3));
  if(currentMinutes<startMinutes-15||currentMinutes>endMinutes){notify(`Въезд недоступен по времени. Бронь действует с ${booking.start} до ${booking.end}.`);return}
  const enteredAt=now.toISOString();
  setBookings(prev=>prev.map(b=>b.id===booking.id?{...b,status:'Активно',entrySimulated:true,entryTime:enteredAt}:b));
  updateLotSpotStatus(booking.parkingId,booking.spot,'Занято');
  addNotice('Въезд по виртуальному чипу',`Чип автомобиля ${vehicle.plate} распознан. Въезд на парковку зарегистрирован.`);
  notify(`Чип ${vehicle.tagId} распознан. Въезд разрешён для ${vehicle.plate}.`);
 }
 function simulateExit(id:string){
  const guardKey=`exit:${id}`;if(transitionGuardRef.current.has(guardKey))return;
  const b=bookings.find(item=>item.id===id);if(!b||b.status!=='Активно'||!b.entrySimulated){notify('Нет активной парковочной сессии для выезда.');return}
  transitionGuardRef.current.add(guardKey);
  const exitedAt=new Date().toISOString();setBookings(prev=>prev.map(item=>item.id===id?{...item,status:'Завершено',exitTime:exitedAt}:item));
  const lotId=Number(b.parkingId||selectedLotId);const other=bookings.some(item=>item.id!==id&&Number(item.parkingId||-1)===lotId&&item.spot===b.spot&&item.date===b.date&&!['Отменено','Завершено'].includes(item.status)&&item.start<b.end&&item.end>b.start);
  if(!other)updateLotSpotStatus(lotId,b.spot,'Свободно');addNotice('Выезд зарегистрирован',`Парковочная сессия ${id} завершена.`);notify(`Выезд зарегистрирован для ${id}. Место освобождено.`);transitionGuardRef.current.delete(guardKey);
 }
 function markRead(){setNotices(n=>n.map(x=>({...x,read:true})));}
 function toggleFavorite(name:string){setFavorites(v=>v.includes(name)?v.filter(x=>x!==name):[...v,name]);notify(favorites.includes(name)?'Удалено из избранного':'Добавлено в избранное')}
 function saveVehicle(){if(!draftVehicle.plate.trim()||!draftVehicle.make.trim()){notify('Укажите номер и марку автомобиля');return}const id=Date.now();setVehicles(v=>[...v,{...draftVehicle,id,tagId:vehicleChipId({id,plate:draftVehicle.plate}),chipEnabled:true}]);setDraftVehicle({plate:'',make:'',model:'',color:'',photo:''});setModal('');notify('Автомобиль добавлен. Виртуальный чип назначен автоматически.')}
 function toggleVehicleChip(id:number){setVehicles(prev=>prev.map(v=>v.id===id?{...v,chipEnabled:v.chipEnabled===false}:v));notify('Настройка виртуального чипа обновлена')}
 function saveProfile(){
  const next={name:draftName.trim(),email:draftEmail.trim().toLowerCase(),phone:draftPhone.trim()};
  if(!next.name||!next.email||!next.email.includes('@')){notify('Проверьте имя и адрес электронной почты');return}
  const users=readUsers();if(users.some((u:any)=>u.email===next.email&&u.email!==account?.email?.toLowerCase())){notify('Этот адрес электронной почты уже используется');return}
  const oldEmail=String(account?.email||'').toLowerCase();
  if(account?.supabaseAuth&&next.email!==oldEmail){notify('Для аккаунта Supabase изменение почты выполняется через подтверждение нового адреса. В этой версии поменяйте только имя и телефон.');return}
  const session={...account,...next,avatar,balance:walletBalance};
  if(account?.supabaseAuth&&supabase){void supabase.from('profiles').update({full_name:next.name,phone:next.phone}).eq('id',account.id).then(({error}:any)=>{if(error)notify(`Профиль локально сохранён, Supabase: ${error.message}`)})}
  else {storeUser(session,oldEmail);if(oldEmail!==next.email){['bookings','vehicles','notices','favorites','subscriptions','payments','payment_methods','notifications_enabled'].forEach(key=>{const from=scopedStoreKey(oldEmail,key),to=scopedStoreKey(next.email,key);const value=localStorage.getItem(from);if(value&&!localStorage.getItem(to))localStorage.setItem(to,value)});}}
  setAccount(session);localStorage.setItem('pm2_account',JSON.stringify(session));localStorage.setItem('pm2_account_v2',JSON.stringify(session));
  setProfileName(next.name);setEmail(next.email);setPhone(next.phone);setModal('');notify('Профиль сохранён');
 }
 function saveAvatarFile(file?:File){
  if(!file)return;if(!file.type.startsWith('image/')){notify('Выберите изображение');return}if(file.size>4_000_000){notify('Фото должно быть меньше 4 МБ');return}
  const reader=new FileReader();reader.onload=()=>{const image=new Image();image.onload=()=>{const canvas=document.createElement('canvas');const side=512;const scale=Math.min(1,side/Math.max(image.width,image.height));canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);const ctx=canvas.getContext('2d');if(!ctx){notify('Не удалось обработать фото');return}ctx.drawImage(image,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/jpeg',0.82);setAvatar(data);const session={...account,avatar:data,balance:walletBalance};setAccount(session);localStorage.setItem('pm2_account',JSON.stringify(session));localStorage.setItem('pm2_account_v2',JSON.stringify(session));if(!account?.supabaseAuth)storeUser({...account,email,name:profileName,phone,avatar:data,balance:walletBalance},email);notify('Аватарка сохранена');};image.onerror=()=>notify('Не удалось открыть изображение');image.src=String(reader.result||'');};reader.readAsDataURL(file);
 }
 function showModal(name:string,data?:any){setModal(name);setModalData(data??null)}
 async function submitAuth(){
  const emailValue=authForm.email.trim().toLowerCase();
  if(!emailValue||!authForm.password){setAuthError('Укажите почту и пароль');return}
  if(isSupabaseConfigured&&supabase){
   try{
    setAuthError('');
    if(authMode==='register'){
     if(!authForm.name.trim()){setAuthError('Укажите имя и фамилию');return}
     const {data,error}=await supabase.auth.signUp({email:emailValue,password:authForm.password,options:{data:{full_name:authForm.name.trim(),phone:authForm.phone||''}}});
     if(error)throw error;
     if(!data.session||!data.user){setAuthError('Регистрация создана. Подтвердите электронную почту по письму от Supabase, затем войдите.');return}
     await supabase.from('profiles').upsert({id:data.user.id,full_name:authForm.name.trim(),phone:authForm.phone||''});
     await restoreSupabaseUser(data.user);return;
    }
    const {data,error}=await supabase.auth.signInWithPassword({email:emailValue,password:authForm.password});
    if(error)throw error;if(!data.user)throw new Error('Не удалось получить пользователя.');
    await restoreSupabaseUser(data.user);return;
   }catch(err:any){setAuthError(err?.message||'Ошибка авторизации Supabase');return}
  }
  const users=readUsers();
  if(authMode==='register'){
   if(!authForm.name.trim()){setAuthError('Укажите имя и фамилию');return}
   if(authForm.password.length<6){setAuthError('Пароль должен содержать не менее 6 символов');return}
   const existing=users.find((u:any)=>u.email===emailValue);
   if(existing){
    if(!(await verifyLocalPassword(authForm.password,existing))){setAuthMode('login');setAuthError('Этот аккаунт уже зарегистрирован. Переключил на вход — введите прежний пароль.');return;}
    if(!existing.passwordHash){const secure=await hashLocalPassword(authForm.password);storeUser({...existing,...secure,password:undefined},emailValue)}
    const session={id:existing.id||emailValue,name:existing.name,email:emailValue,phone:existing.phone||'',avatar:existing.avatar||'',balance:Number(existing.balance??3000)};
    activateLocalAccount(session);setAuthError('');return;
   }
   const credentials=await hashLocalPassword(authForm.password);const u={id:`USR-${Date.now()}`,name:authForm.name.trim(),email:emailValue,...credentials,phone:authForm.phone||'',avatar:'',balance:3000};
   const nextUsers=[...users,u];localStorage.setItem('pm2_users_v2',JSON.stringify(nextUsers));localStorage.setItem('pm2_users',JSON.stringify(nextUsers));
   const session={id:u.id,name:u.name,email:u.email,phone:u.phone,avatar:u.avatar,balance:u.balance};activateLocalAccount(session);setAuthError('');
  }else{
   const u=users.find((x:any)=>x.email===emailValue);
   if(!u||!(await verifyLocalPassword(authForm.password,u))){setAuthError('Неверная почта или пароль. Проверьте раскладку и адрес почты.');return}
   if(!u.passwordHash){const secure=await hashLocalPassword(authForm.password);storeUser({...u,...secure,password:undefined},emailValue)}
   const session={id:u.id||emailValue,name:u.name,email:u.email,phone:u.phone||'',avatar:u.avatar||'',balance:Number(u.balance??3000)};
   activateLocalAccount(session);setAuthError('');
  }
 }
 async function logout(){if(isSupabaseConfigured&&supabase&&account?.supabaseAuth){const {error}=await supabase.auth.signOut();if(error){notify(error.message);return}}localStorage.removeItem('pm2_account');localStorage.removeItem('pm2_account_v2');setAccount(null);setModal('');setAuthMode('login')}
 if(!account)return <AuthPage mode={authMode} setMode={setAuthMode} form={authForm} setForm={setAuthForm} error={authError} onSubmit={submitAuth}/>;
 return <div className="app-shell" data-app-version="v17-satellite-mobile-navigation">
  <header className="mobile-header"><div className="brand brand-home" role="button" tabIndex={0} onClick={()=>go('Главная')} onKeyDown={e=>e.key==='Enter'&&go('Главная')} title="На главную"><span className="brand-mark"><CircleParking size={22}/></span><b>Parking Manager</b></div><button className="round-icon" onClick={()=>{setShowNotifications(!showNotifications);markRead()}}><Bell size={19}/>{notices.some(n=>!n.read)&&<i/>}</button></header>
  <aside className={`sidebar ${mobileMenu?'open':''}`}><div className="brand desktop-brand brand-home" role="button" tabIndex={0} onClick={()=>go('Главная')} onKeyDown={e=>e.key==='Enter'&&go('Главная')} title="На главную"><span className="brand-mark"><CircleParking size={24}/></span><div><b>Parking Manager</b><small>Управление парковкой</small></div><button className="close-menu" onClick={e=>{e.stopPropagation();setMobileMenu(false)}}><X/></button></div><div className="side-label">МЕНЮ</div><nav>{NAV.map(({name,icon:Icon})=><button key={name} className={`nav-item ${screen===name?'active':''}`} onClick={()=>go(name)}><Icon size={18}/><span>{name}</span>{name==='История'&&<small>{bookings.length}</small>}</button>)}</nav><div className="sidebar-bottom"><div className="help-card"><CircleHelp size={18}/><b>Нужна помощь?</b><p>Ответы на вопросы и поддержка</p><button onClick={()=>showModal('support')}>Открыть поддержку <ChevronRight size={14}/></button></div><div className="user-mini"><div className="avatar">{avatar?<img src={avatar} alt="Аватар"/>:initials(profileName)}</div><div><b>{profileName}</b><small>{email}</small></div><button title="Профиль" onClick={()=>go('Профиль')}><Settings size={17}/></button></div></div></aside>
  {mobileMenu&&<button className="scrim" onClick={()=>setMobileMenu(false)} aria-label="Закрыть меню"/>}
  <main className="main"><header className="topbar"><div className="top-left"><button className="hamburger" onClick={()=>setMobileMenu(true)}><SlidersHorizontal/></button><div><div className="breadcrumbs">Parking Manager <ChevronRight size={13}/> <b>{screen}</b></div><h1>{screen}</h1></div></div><div className="top-actions"><span className="wallet-topbar">Баланс: {money(walletBalance)}</span><span className="system-status"><i/> Система активна</span><button className="round-icon desktop-notice" onClick={()=>{setShowNotifications(!showNotifications);markRead()}}><Bell size={18}/>{notices.some(n=>!n.read)&&<i/>}</button><div className="avatar">{avatar?<img src={avatar} alt="Аватар"/>:initials(profileName)}</div></div></header>
  {showNotifications&&<div className="notification-pop"><div className="pop-head"><b>Уведомления</b><button onClick={()=>setShowNotifications(false)}><X size={16}/></button></div>{notices.length?notices.map(n=><div className="notice-row" key={n.id}><span className="notice-dot"/><div><b>{n.title}</b><p>{n.text}</p><small>{n.time}</small></div></div>):<p className="empty-text">Уведомлений пока нет</p>}<button className="link-btn" onClick={()=>{go('История');setShowNotifications(false)}}>Перейти к бронированиям</button></div>}
  {screen==='Главная'&&<Dashboard bookings={myBookings} onNavigate={go} onPass={openPass} profileName={profileName}/>}
  {(screen==='Парковки'||screen==='Навигатор')&&<ParkingPage spots={spots} setSpots={setSpots} selected={selectedSpot} onSelect={setSelectedSpot} query={query} setQuery={setQuery} zone={zone} setZone={setZone} favorites={favorites} onFavorite={toggleFavorite} onBook={()=>{if(selectedSpot)go('Бронирование');else notify('Сначала выберите свободное место')}} onGoBooking={()=>go('Бронирование')} parkingName={parkingName} setParkingName={setParkingName} address={address} setAddress={setAddress} tariff={tariff} setTariff={setTariff} selectedLotId={selectedLotId} setSelectedLotId={setSelectedLotId} vehicles={vehicles} vehicleId={vehicleId} setVehicleId={setVehicleId} onChipEntry={simulateVehicleChipEntry} notify={notify} onLotsChange={setParkingCatalog}/>}
  {screen==='Бронирование'&&<BookingPage spots={spots} selected={selectedSpot} onSelect={setSelectedSpot} date={date} setDate={setDate} start={start} setStart={setStart} end={end} setEnd={setEnd} vehicles={vehicles} vehicleId={vehicleId} setVehicleId={setVehicleId} total={total} tariff={tariff} subscriptionDiscount={subscriptionDiscount} promo={promo} setPromo={setPromo} promoApplied={promoApplied} applyPromo={applyPromo} onCreate={createBooking} onGoMap={()=>go('Навигатор')} lots={parkingCatalog} selectedLotId={selectedLotId} parkingName={parkingName} parkingAddress={address} onSelectParking={(id:number)=>{const lot=parkingCatalog.find((item:any)=>Number(item.id)===Number(id));if(!lot)return;setSelectedLotId(lot.id);setSpots(readParkingSpotsForLot(lot.id));setSelectedSpot(null);setParkingName(lot.name);setAddress(`Москва, ${cleanMoscowAddress(lot.address||lot.name)}`);setTariff(lot.price??200)}}/>}
  {screen==='История'&&<HistoryPage bookings={filteredBookings} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} onExport={exportCSV} onPass={openPass} onCancel={cancelBooking} onExit={simulateExit} onExtend={(b:Booking)=>{setModalData(b);setExtendEnd(b.end);setModal('extend')}} onPay={(b:Booking)=>{setModalData(b);setModal('payment')}} payments={visiblePayments} onReceipt={downloadReceipt}/>}
  {screen==='Статистика'&&<StatisticsPage bookings={myBookings} payments={visiblePayments} onExport={exportCSV}/>}
  {screen==='Профиль'&&<ProfilePage cloudSyncConfigured={isSupabaseConfigured&&Boolean(account?.supabaseAuth)} profileName={profileName} email={email} phone={phone} avatar={avatar} walletBalance={walletBalance} onAvatarUpload={saveAvatarFile} onTopUp={openTopUp} paymentMethods={paymentMethods} onBindCard={()=>setModal('bindCard')} onBindSbp={()=>setModal('bindSbp')} onRemovePaymentMethod={(id:string)=>setPaymentMethods(prev=>prev.filter(m=>m.id!==id))} onOpenFavorite={(name:string)=>{setQuery(name);go('Парковки')}} notificationsEnabled={notificationsEnabled} onToggleNotifications={()=>setNotificationsEnabled(v=>{const next=!v;if(next&&typeof Notification!=='undefined'&&Notification.permission==='default')void Notification.requestPermission();return next})} vehicles={vehicles} onEdit={()=>{setDraftName(profileName);setDraftEmail(email);setDraftPhone(phone);showModal('editProfile')}} onAddVehicle={()=>showModal('addVehicle')} onDeleteVehicle={(id:number)=>setVehicles(v=>v.filter(x=>x.id!==id))} favorites={favorites} onFavorite={toggleFavorite} onToggleVehicleChip={toggleVehicleChip} subscriptions={subscriptions} onSubscription={subscribeToPlan} onCancelSubscription={cancelSubscription} notify={notify} onSupport={()=>showModal('support')} onLogout={logout}/>}
  </main>
  <nav className="bottom-nav" aria-label="Основная навигация">{NAV.map(({name,icon:Icon})=><button key={name} className={screen===name?'active':''} onClick={()=>go(name)}><Icon size={18}/><span>{name==='Парковки'?'Карта':name==='Бронирование'?'Бронь':name==='История'?'История':name==='Профиль'?'Профиль':name==='Статистика'?'Аналитика':'Главная'}</span></button>)}</nav>
  {toast&&<div className="toast"><CheckCircle2 size={17}/>{toast}</div>}
  {modal&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setModal('')}}><div className="modal"><div className="modal-head"><b>{modalTitle(modal)}</b><button onClick={()=>setModal('')}><X size={18}/></button></div>
   {modal==='topup'&&<><p className="modal-copy">Выберите способ демонстрационного пополнения. Реальное списание денег не выполняется.</p><label className="field">Сумма пополнения, ₽<input type="number" min="100" max="100000" step="100" value={topUpAmount} onChange={e=>setTopUpAmount(e.target.value)}/></label><div className="topup-method-choice"><button className={topUpChannel==='sbp'?'active':''} onClick={()=>setTopUpChannel('sbp')}><Smartphone size={18}/> СБП</button><button className={topUpChannel==='card'?'active':''} onClick={()=>setTopUpChannel('card')}><CreditCard size={18}/> Банковская карта</button></div>{paymentMethods.filter(m=>m.kind===topUpChannel).map(m=><div className="bound-method" key={m.id}><CheckCircle2 size={17}/><div><b>{m.label}</b><small>{m.details}</small></div></div>)}{!paymentMethods.some(m=>m.kind===topUpChannel)&&<p className="wallet-insufficient">Этот способ ещё не привязан. Сначала добавьте виртуальный способ оплаты.</p>}<button className="secondary-btn full" onClick={()=>setModal(topUpChannel==='sbp'?'bindSbp':'bindCard')}>Привязать {topUpChannel==='sbp'?'СБП':'карту'}</button><button className="primary-btn full" onClick={confirmTopUp}>Пополнить баланс</button></>}
   {modal==='bindCard'&&<><p className="modal-copy">Виртуальная привязка для демонстрации интерфейса. Не вводите данные настоящей карты.</p><label className="field">Имя держателя<input value={draftCard.holder} onChange={e=>setDraftCard({...draftCard,holder:e.target.value})} placeholder="IVAN IVANOV"/></label><label className="field">Тестовый номер карты<input inputMode="numeric" maxLength={19} value={draftCard.number} onChange={e=>setDraftCard({...draftCard,number:e.target.value.replace(/[^0-9 ]/g,'').slice(0,19)})} placeholder="0000 0000 0000 0000"/></label><label className="field">Срок действия<input value={draftCard.expiry} onChange={e=>setDraftCard({...draftCard,expiry:e.target.value.replace(/[^0-9/]/g,'').slice(0,5)})} placeholder="ММ/ГГ"/></label><button className="primary-btn full" onClick={bindVirtualCard}>Сохранить виртуальную карту</button></>}
   {modal==='bindSbp'&&<><p className="modal-copy">Виртуальная привязка номера для демонстрации СБП. Переводы не выполняются.</p><label className="field">Банк<select value={draftSbp.bank} onChange={e=>setDraftSbp({...draftSbp,bank:e.target.value})}><option>Тестовый банк</option><option>Банк Parking Demo</option><option>Демо-Банк</option></select></label><label className="field">Телефон для тестовой привязки<input value={draftSbp.phone} onChange={e=>setDraftSbp({...draftSbp,phone:e.target.value})} placeholder="+7 900 000-00-00"/></label><button className="primary-btn full" onClick={bindVirtualSbp}>Привязать виртуальный СБП</button></>}
   {modal==='payment'&&<><div className="wallet-payment-top"><div><small>ВАШ БАЛАНС</small><b>{money(walletBalance)}</b></div><Wallet size={28}/></div><p className="modal-copy">Бронирование {modalData?.id}. Сумма списывается с вашего внутреннего баланса Parking Manager.</p><div className="pay-summary"><span>{modalData?.spot} · {modalData?.date}<small>{modalData?.start}–{modalData?.end}</small></span><b>{money(modalData?.amount||0)}</b></div>{walletBalance>=(modalData?.amount||0)?<button className="primary-btn full" onClick={payBooking}><Wallet size={16}/> Оплатить с баланса</button>:<><div className="wallet-insufficient">Не хватает {money((modalData?.amount||0)-walletBalance)} для оплаты.</div><button className="primary-btn full" onClick={()=>{setTopUpAmount(String(Math.max(500,Math.ceil(((modalData?.amount||0)-walletBalance)/500)*500)));setTopUpChannel('sbp');setModal('topup')}}><Plus size={16}/> Пополнить на {money(Math.max(500,Math.ceil(((modalData?.amount||0)-walletBalance)/500)*500))}</button></>}</>}
   {modal==='paymentSuccess'&&<><div className="payment-result success"><CheckCircle2 size={42}/><b>Оплата прошла успешно</b><span>Списаны средства внутреннего учебного баланса. Реальные деньги не списываются.</span></div><div className="pay-summary"><span>Номер чека<small>{modalData?.record?.receiptNo}</small></span><b>{money(modalData?.record?.amount||0)}</b></div><div className="receipt-details"><span>Бронирование</span><b>{modalData?.booking?.id}</b><span>Способ оплаты</span><b>{modalData?.record?.method}</b><span>Статус</span><b className="receipt-success">Успешно</b></div><button className="primary-btn full" onClick={()=>downloadReceipt(modalData.record)}><Download size={15}/> Скачать чек</button><button className="text-link demo-back" onClick={()=>{setModal('');setModalData(null);go('История')}}>Готово</button></>}
   {modal==='pass'&&<><div className="pass-box"><div className="qr-code-card"><QRCodeSVG value={JSON.stringify({app:'Parking Manager',type:'demo-parking-pass',bookingId:modalData?.id,spot:modalData?.spot,date:modalData?.date,start:modalData?.start,end:modalData?.end,pass:modalData?.pass})} size={210} level="H" includeMargin/></div><b>{modalData?.id}</b><span>Электронный пропуск</span><strong>{modalData?.spot}</strong><small>{modalData?.date} · {modalData?.start}–{modalData?.end}</small></div><div className="info-note"><ShieldCheck size={18}/> QR-код содержит читаемые данные демонстрационного пропуска. Он настоящий и сканируется камерой, но не связан с реальным шлагбаумом.</div><button className="primary-btn full" onClick={simulateEntry}>Сымитировать въезд · использовать QR</button></>}
   {modal==='extend'&&<><p className="modal-copy">Продление бронирования {modalData?.id} · место {modalData?.spot}. Доступность следующего интервала будет проверена.</p><label className="field">Новое время выезда<input type="time" value={extendEnd} onChange={e=>setExtendEnd(e.target.value)}/></label><p className="pay-summary"><span>Доплата</span><b>{money(Math.max(0,hoursBetween(modalData?.end||'00:00',extendEnd)*tariff))}</b></p><button className="primary-btn full" onClick={extendSession}>Продлить парковку</button></>}
   {modal==='editProfile'&&<><label className="field">Имя и фамилия<input value={draftName} onChange={e=>setDraftName(e.target.value)}/></label><label className="field">Электронная почта<input type="email" value={draftEmail} onChange={e=>setDraftEmail(e.target.value)}/></label><label className="field">Телефон<input value={draftPhone} onChange={e=>setDraftPhone(e.target.value)}/></label><button className="primary-btn full" onClick={saveProfile}>Сохранить изменения</button></>}
   {modal==='addVehicle'&&<><label className="field">Госномер<input placeholder="А123ВС 777" value={draftVehicle.plate} onChange={e=>setDraftVehicle({...draftVehicle,plate:e.target.value.toUpperCase()})}/></label><label className="field">Марка<input placeholder="Toyota" value={draftVehicle.make} onChange={e=>setDraftVehicle({...draftVehicle,make:e.target.value})}/></label><label className="field">Модель<input placeholder="Camry" value={draftVehicle.model} onChange={e=>setDraftVehicle({...draftVehicle,model:e.target.value})}/></label><label className="field">Цвет<input placeholder="Белый" value={draftVehicle.color} onChange={e=>setDraftVehicle({...draftVehicle,color:e.target.value})}/></label><label className="field">Фотография автомобиля<input type="file" accept="image/*" onChange={e=>{const f=e.target.files?.[0];if(f){if(f.size>1800000){notify('Фото должно быть меньше 1,8 МБ');return}const reader=new FileReader();reader.onload=()=>setDraftVehicle({...draftVehicle,photo:String(reader.result)});reader.readAsDataURL(f)}}}/></label>{draftVehicle.photo&&<img className="vehicle-preview" src={draftVehicle.photo} alt="Предпросмотр автомобиля"/>}<p className="hint">После добавления машине автоматически назначается виртуальный чип Parking Manager для демонстрации въезда.</p><button className="primary-btn full" onClick={saveVehicle}>Добавить автомобиль</button></>}
   {modal==='support'&&<><p className="modal-copy">Помощник Parking Manager подсказывает по шагам и помогает разобраться с бронированиями, QR, балансом, зонами и настройками.</p><div className="support-suggestions">{['Как работают зоны A и B?','Почему QR исчез после въезда?','Как забронировать место?','Как пополнить баланс?'].map((q:string)=><button key={q} onClick={()=>setSupportDraft(q)}>{q}</button>)}</div><div className="support-chat">{supportMessages.map((m:any)=><div key={m.id} className={`support-message ${m.role==='user'?'from-user':'from-assistant'}`}><b>{m.role==='user'?'Вы':'Помощник'}</b><p>{m.text}</p></div>)}{supportBusy&&<div className="support-message from-assistant"><b>Помощник</b><p>Подбираю ответ…</p></div>}</div><form className="support-compose" onSubmit={e=>{e.preventDefault();sendSupportMessage()}}><input value={supportDraft} onChange={e=>setSupportDraft(e.target.value)} placeholder="Напишите свой вопрос…"/><button className="primary-btn" disabled={!supportDraft.trim()||supportBusy}>Отправить</button></form></>}
   {modal==='logout'&&<><p className="modal-copy">Вы действительно хотите завершить демонстрационный сеанс?</p><button className="primary-btn full" onClick={()=>{setModal('');notify('Выход из демо-режима')}}>Завершить сеанс</button></>}
  </div></div>}
 </div>
}
function AuthPage({mode,setMode,form,setForm,error,onSubmit}:any){return <div className="auth-screen"><div className="auth-card"><div className="auth-brand"><span className="brand-mark"><CircleParking size={27}/></span><div><b>Parking Manager</b><small>Парковки Москвы</small></div></div><div className="auth-tabs"><button className={mode==='register'?'active':''} onClick={()=>setMode('register')}>Регистрация</button><button className={mode==='login'?'active':''} onClick={()=>setMode('login')}>Вход</button></div><h1>{mode==='register'?'Создать аккаунт':'С возвращением'}</h1><p className="auth-subtitle">{mode==='register'?'Зарегистрируйтесь, чтобы находить парковки и бронировать места.':'Войдите в свой аккаунт Parking Manager.'}</p>{mode==='register'&&<label className="field">Имя и фамилия<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Иван Иванов"/></label>}<label className="field">Электронная почта<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="name@example.com"/></label>{mode==='register'&&<label className="field">Телефон <span className="optional">необязательно</span><input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="+7 900 000-00-00"/></label>}<label className="field">Пароль<input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="Не менее 6 символов" onKeyDown={e=>e.key==='Enter'&&onSubmit()}/></label>{error&&<div className="auth-error">{error}</div>}<button className="primary-btn full" onClick={onSubmit}>{mode==='register'?'Создать аккаунт':'Войти в аккаунт'}</button><p className="auth-foot">{isSupabaseConfigured?'Защищённый вход через Supabase Auth.':'Демо-вход хранится только в этом браузере. Для безопасной авторизации настройте Supabase в .env.local.'} Администраторские роли не предусмотрены.</p></div></div>}

function StatisticsPage({bookings,payments,onExport}:any){const paid=payments.filter((p:PaymentRecord)=>p.status==='Успешно');const total=paid.reduce((n:number,p:PaymentRecord)=>n+p.amount,0);const hours=bookings.filter((b:Booking)=>['Подтверждено','Активно','Завершено'].includes(b.status)).reduce((n: number,b:Booking)=>n+hoursBetween(b.start,b.end),0);const active=bookings.filter((b:Booking)=>['Подтверждено','Активно'].includes(b.status)).length;const months=['Янв','Фев','Мар','Апр','Май','Июн'];return <div className="content"><div className="page-intro"><h2>Статистика</h2><p>Ваши расходы и история использования парковок</p></div><div className="analytics-grid"><article><small>РАСХОДЫ ПО ДЕМО-ОПЛАТАМ</small><b>{money(total)}</b><span>{paid.length} успешных операций</span></article><article><small>ЧАСОВ ПАРКОВКИ</small><b>{hours.toFixed(1)}</b><span>По всем бронированиям</span></article><article><small>АКТИВНЫЕ БРОНИ</small><b>{active}</b><span>Подтверждены или активны</span></article><article><small>ВСЕ БРОНИРОВАНИЯ</small><b>{bookings.length}</b><span>Включая отменённые</span></article></div><section className="analytics-panel"><div className="section-head"><h3 className="section-title">Статусы бронирований</h3><span>Всего: {bookings.length}</span></div>{['Подтверждено','Ожидает оплаты','Активно','Завершено','Отменено'].map((status:string)=>{const count=bookings.filter((b:Booking)=>b.status===status).length;const pct=bookings.length?count/bookings.length*100:0;return <div className="bar-row" key={status}><div><span>{status}</span><b>{count}</b></div><i><em style={{width:`${pct}%`}}/></i></div>})}</section><section className="analytics-panel"><h3 className="section-title">Последние платежи</h3>{paid.slice(0,6).map((p:PaymentRecord)=><div className="analytics-payment" key={p.id}><span>{p.bookingId} · {p.method}</span><b>{money(p.amount)}</b></div>)}{!paid.length&&<p className="hint">Пока нет успешных демонстрационных платежей.</p>}</section><button className="primary-btn" onClick={onExport}><Download size={15}/> Экспортировать отчёт CSV</button><p className="hint">Статистика рассчитывается по данным этого браузера. Это не банковская выписка.</p></div>}

function modalTitle(m:string){return ({payment:'Оплата бронирования',paymentSuccess:'Чек об оплате',paymentFailed:'Результат оплаты',pass:'Электронный пропуск',topup:'Пополнение баланса',bindCard:'Привязка банковской карты',bindSbp:'Привязка СБП',extend:'Продление парковки',editProfile:'Редактирование профиля',addVehicle:'Добавить автомобиль',support:'Поддержка',logout:'Выход из аккаунта'} as any)[m]||'Информация'}

function Dashboard({bookings,onNavigate,onPass,profileName}:any){
 const hour=new Date().getHours();const greeting=hour<12?'Доброе утро':hour<18?'Добрый день':'Добрый вечер';
 const active=[...bookings].filter((b:Booking)=>['Подтверждено','Активно'].includes(b.status)&&b.date>=todayISO()).sort((a:Booking,b:Booking)=>`${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`))[0];
 return <div className="content dashboard-simple"><div className="greeting"><div><span className="eyebrow">PARKING MANAGER</span><h2>{greeting}, {profileName.split(' ')[0]||'водитель'}</h2><p>Ваши парковочные бронирования</p></div></div>
 {active?<section className="dashboard-active-booking"><div className="dashboard-card-head"><span className="dashboard-status"><i/> АКТИВНОЕ БРОНИРОВАНИЕ</span><b>{active.id}</b></div><div className="dashboard-booking-main"><div className="dashboard-booking-icon"><CarFront size={26}/></div><div><h3>Место {active.spot}</h3><p>{active.car} · {active.parkingName||"Парковка"}</p></div></div><div className="dashboard-booking-details"><span><small>ДАТА</small><b>{new Date(`${active.date}T00:00:00`).toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'})}</b></span><span><small>ВРЕМЯ</small><b>{active.start}–{active.end}</b></span><span><small>СТОИМОСТЬ</small><b>{money(active.amount)}</b></span></div><div className="dashboard-card-actions">{!active.entrySimulated?<button className="primary-btn" onClick={()=>onPass(active)}><QrCode size={16}/> Открыть пропуск</button>:<span className="entry-used-label dashboard-entry-used"><CheckCircle2 size={14}/> Въезд уже выполнен, QR использован</span>}<button className="secondary-btn" onClick={()=>onNavigate('История')}>Все бронирования</button></div></section>:<section className="dashboard-empty-booking"><div className="dashboard-empty-icon"><MapPinned size={32}/></div><h3>Пока нет активных бронирований</h3><p>Выберите парковку, место и удобное время — всё остальное можно сделать в приложении.</p><button className="primary-btn" onClick={()=>onNavigate('Бронирование')}><Plus size={17}/> Забронировать парковку</button></section>}
 </div>
}
const MOSCOW_PARKINGS=[
 {id:1,name:'Парковка «Охотный Ряд»',address:'Манежная площадь, 1',lat:55.7558,lon:37.6176,free:18,price:450,hours:'круглосуточно'},
 {id:2,name:'Парковка «Парк Зарядье»',address:'ул. Варварка, 6',lat:55.7517,lon:37.6285,free:24,price:400,hours:'08:00–23:00'},
 {id:3,name:'Парковка «Арбат»',address:'Новый Арбат, 15',lat:55.7521,lon:37.5905,free:11,price:350,hours:'круглосуточно'},
 {id:4,name:'Парковка «Патриаршие»',address:'Большой Патриарший пер., 8',lat:55.7624,lon:37.5928,free:7,price:500,hours:'круглосуточно'},
 {id:5,name:'Парковка «Белорусская»',address:'2-я Брестская ул., 43',lat:55.7765,lon:37.5822,free:16,price:300,hours:'06:00–00:00'},
 {id:6,name:'Парковка «Киевская»',address:'площадь Киевского Вокзала, 2',lat:55.7447,lon:37.5662,free:21,price:320,hours:'круглосуточно'},
 {id:7,name:'Парковка «Москва-Сити»',address:'Пресненская наб., 8',lat:55.7493,lon:37.5395,free:32,price:550,hours:'круглосуточно'},
 {id:8,name:'Парковка «Павелецкая»',address:'Павелецкая площадь, 1',lat:55.7298,lon:37.6383,free:14,price:300,hours:'06:00–00:00'},
 {id:9,name:'Парковка «Третьяковская»',address:'Климентовский пер., 10',lat:55.7405,lon:37.6262,free:9,price:380,hours:'круглосуточно'},
 {id:10,name:'Парковка «Парк Горького»',address:'Крымский Вал, 9',lat:55.7314,lon:37.6035,free:26,price:350,hours:'07:00–23:00'},
 {id:11,name:'Парковка «Савёловская»',address:'Бутырская ул., 2',lat:55.7921,lon:37.5881,free:13,price:280,hours:'круглосуточно'},
 {id:12,name:'Парковка «Рассказовка»',address:'ул. Анны Ахматовой, 1',lat:55.6338,lon:37.3334,free:20,price:220,hours:'круглосуточно'},
 {id:13,name:'Парковка «ВДНХ»',address:'проспект Мира, 119',lat:55.8296,lon:37.6331,free:28,price:250,hours:'07:00–00:00'},
 {id:14,name:'Парковка «Сокольники»',address:'Сокольнический Вал, 1',lat:55.7944,lon:37.6799,free:17,price:230,hours:'круглосуточно'},
 {id:15,name:'Парковка «Лужники»',address:'ул. Лужники, 24',lat:55.7158,lon:37.5537,free:31,price:300,hours:'06:00–23:00'},
 {id:16,name:'Парковка «Коломенское»',address:'проспект Андропова, 39',lat:55.6677,lon:37.6697,free:19,price:200,hours:'08:00–22:00'},
 {id:17,name:'Парковка «Курская»',address:'Земляной Вал, 29',lat:55.7577,lon:37.6598,free:12,price:320,hours:'круглосуточно'},
 {id:18,name:'Парковка «Тверская»',address:'Тверская улица,  с. 1',lat:55.7649,lon:37.6056,free:8,price:500,hours:'круглосуточно'},
 {id:19,name:'Парковка «ВДНХ Южная»',address:'ул. Космонавтов, 2',lat:55.8188,lon:37.6382,free:15,price:240,hours:'07:00–23:00'},
 {id:20,name:'Парковка «Новокузнецкая»',address:'Пятницкая улица, 25',lat:55.7412,lon:37.6297,free:6,price:390,hours:'круглосуточно'}
];
function cleanMoscowAddress(value:any){
 const text=String(value||'Адрес не указан').trim();
 return text.replace(/^(?:г\.?\s*)?Москва,\s*/i,'').replace(/\s+/g,' ').trim()||'Адрес не указан';
}
function withDemoAvailability(lot:any){
 const id=Math.max(1,Number(lot.id)||1);
 const lotSpots=readParkingSpotsForLot(id);
 const totalSpaces=lotSpots.length;
 const occupied=lotSpots.filter(s=>s.status==='Занято').length;
 const reserved=lotSpots.filter(s=>s.status==='Забронировано').length;
 const free=Math.max(0,totalSpaces-occupied-reserved);
 return {...lot,totalSpaces,occupied,reserved,free,occupancyRate:totalSpaces?Math.round((occupied+reserved)/totalSpaces*100):0,availabilityMode:'demo'};
}
function normalizeParkingRecord(p:any){
 const id=Number(p.id);
 const rawAddress=p.address||p.name||p.title||'Адрес не указан';
 const address=cleanMoscowAddress(rawAddress);
 const name=String(p.title||p.parkingName||(String(p.name||'').startsWith('Парковка')?p.name:`Парковка на ${address}`));
 return withDemoAvailability({id,name,address,lat:Number(p.lat),lon:Number(p.lng??p.lon),free:null,price:p.price==null?null:Number(p.price),hours:p.hours||'режим работы не указан',source:p.source||'open-data',photo:p.photo||parkingPhoto(id)});
}

const ROUTING_BASE_URL = String((import.meta as any).env?.VITE_ROUTING_BASE_URL || 'https://router.project-osrm.org').replace(/\/+$/, '');
let routingRequestChain:Promise<void>=Promise.resolve();
let lastRoutingRequestAt=0;
function waitForRoutingRateLimit(){
 const run=async()=>{const wait=Math.max(0,1100-(Date.now()-lastRoutingRequestAt));if(wait)await new Promise<void>(resolve=>window.setTimeout(resolve,wait));lastRoutingRequestAt=Date.now()};
 routingRequestChain=routingRequestChain.then(run,run);return routingRequestChain;
}
function formatRouteDistance(meters:number){
 if(!Number.isFinite(meters))return '—';
 return meters<1000?`${Math.round(meters)} м`:`${(meters/1000).toLocaleString('ru-RU',{maximumFractionDigits:1})} км`;
}
function formatRouteDuration(seconds:number){
 if(!Number.isFinite(seconds))return '—';
 const minutes=Math.max(1,Math.round(seconds/60));
 if(minutes<60)return `${minutes} мин`;
 const hours=Math.floor(minutes/60),rest=minutes%60;
 return rest?`${hours} ч ${rest} мин`:`${hours} ч`;
}
function haversineMeters(a:{lat:number;lon:number},b:{lat:number;lon:number}){
 const rad=(v:number)=>v*Math.PI/180;
 const dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon);
 const h=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
 return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}
function routeInstruction(step:any,index:number){
 const maneuver=step?.maneuver||{};
 const type=String(maneuver.type||'');
 const modifier=String(maneuver.modifier||'');
 const road=String(step?.name||step?.ref||'').trim();
 const roadText=road?` на ${road}`:'';
 const directions:Record<string,string>={
  'slight left':'Плавно поверните налево','left':'Поверните налево','sharp left':'Резко поверните налево',
  'slight right':'Плавно поверните направо','right':'Поверните направо','sharp right':'Резко поверните направо',
  'straight':'Продолжайте прямо','uturn':'Развернитесь и двигайтесь в обратном направлении'
 };
 let action='Продолжайте движение';
 if(type==='depart')action='Начните движение';
 else if(type==='arrive')action='Вы прибыли к месту назначения';
 else if(type==='turn'||type==='end of road'||type==='fork')action=directions[modifier]||'Следуйте по указателю';
 else if(type==='continue'||type==='new name'||type==='notification')action='Продолжайте движение';
 else if(type==='merge')action='Перестройтесь и продолжайте движение';
 else if(type==='on ramp')action='Выезжайте на съезд';
 else if(type==='off ramp')action='Съезжайте с дороги';
 else if(type==='roundabout'||type==='rotary'){const exit=Number(maneuver.exit);action=exit>0?`На круговом движении используйте ${exit}-й съезд`:'На круговом движении следуйте к нужному съезду'}
 else if(type==='exit roundabout')action='Покиньте круговое движение';
 else if(type==='uturn')action=directions.uturn;
 const distance=Number(step?.distance||0);
 const distanceText=distance>5?` · ${formatRouteDistance(distance)}`:'';
 return `${action}${roadText}${distanceText}`;
}
async function requestDrivingRoute(origin:{lat:number;lon:number},destination:{lat:number;lon:number}) : Promise<DrivingRoute>{
 const coords=`${origin.lon.toFixed(6)},${origin.lat.toFixed(6)};${destination.lon.toFixed(6)},${destination.lat.toFixed(6)}`;
 const url=`${ROUTING_BASE_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`;
 await waitForRoutingRateLimit();
 const controller=new AbortController();
 const timeout=window.setTimeout(()=>controller.abort(),25000);
 let response:Response;
 try{response=await fetch(url,{signal:controller.signal,headers:{Accept:'application/json'}})}
 catch(error:any){
  if(error?.name==='AbortError')throw new Error('Маршрутизатор не ответил за 25 секунд. Попробуйте ещё раз.');
  throw new Error('Не удалось связаться с маршрутизатором. Проверьте интернет и попробуйте ещё раз.');
 }finally{window.clearTimeout(timeout)}
 if(!response.ok)throw new Error(`Сервис маршрутизации ответил с ошибкой HTTP ${response.status}.`);
 const payload=await response.json();
 if(payload?.code!=='Ok'||!Array.isArray(payload?.routes)||!payload.routes.length){
  if(payload?.code==='NoRoute')throw new Error('Не удалось найти автомобильный маршрут между этими точками.');
  if(payload?.code==='NoSegment')throw new Error('GPS-точка или парковка находится далеко от автомобильной дороги. Попробуйте обновить геопозицию или выбрать другую парковку.');
  throw new Error('Маршрутизатор не смог построить маршрут. Попробуйте другую парковку.');
 }
 const route=payload.routes[0];
 const coordinates=(route.geometry?.coordinates||[]).filter((point:any)=>Array.isArray(point)&&Number.isFinite(Number(point[0]))&&Number.isFinite(Number(point[1]))) as [number,number][];
 if(coordinates.length<2)throw new Error('Маршрутизатор вернул неполную геометрию маршрута.');
 const rawSteps=(route.legs||[]).flatMap((leg:any)=>leg.steps||[]);
 const steps:DrivingRouteStep[]=rawSteps.map((step:any,index:number)=>{
  const location=(step?.maneuver?.location||step?.geometry?.coordinates?.[0]||coordinates[0]) as [number,number];
  const loc={lat:Number(location[1]),lon:Number(location[0])};
  let routeIndex=0,best=Infinity;
  coordinates.forEach((point,index)=>{const d=haversineMeters(loc,{lat:Number(point[1]),lon:Number(point[0])});if(d<best){best=d;routeIndex=index}});
  return {instruction:routeInstruction(step,index),road:String(step?.name||step?.ref||''),distance:Number(step?.distance||0),duration:Number(step?.duration||0),routeIndex,location:[Number(location[0]),Number(location[1])]};
 }).filter((step:DrivingRouteStep,index:number)=>step.distance>3||index===rawSteps.length-1);
 const start=(payload.waypoints?.[0]?.location||coordinates[0]) as [number,number];
 const end=(payload.waypoints?.[1]?.location||coordinates[coordinates.length-1]) as [number,number];
 return {geometry:{coordinates},distance:Number(route.distance||0),duration:Number(route.duration||0),steps,start,end};
}
function nearestRoutePoint(position:{lat:number;lon:number},coordinates:[number,number][]){
 let index=0,distance=Infinity;
 coordinates.forEach((point,i)=>{const d=haversineMeters(position,{lat:Number(point[1]),lon:Number(point[0])});if(d<distance){distance=d;index=i}});
 return {index,distance};
}
function distanceAlongRouteToStep(position:{lat:number;lon:number},route:DrivingRoute,step:DrivingRouteStep){
 const nearest=nearestRoutePoint(position,route.geometry.coordinates);
 const targetIndex=Math.max(nearest.index,Math.min(route.geometry.coordinates.length-1,step.routeIndex));
 let total=0;
 for(let i=nearest.index;i<targetIndex;i++){
  const a=route.geometry.coordinates[i],b=route.geometry.coordinates[i+1];
  if(a&&b)total+=haversineMeters({lat:a[1],lon:a[0]},{lat:b[1],lon:b[0]});
 }
 return total;
}
function remainingRouteMeters(position:{lat:number;lon:number}|null,route:DrivingRoute){
 if(!position)return route.distance;
 const nearest=nearestRoutePoint(position,route.geometry.coordinates);
 let total=0;
 for(let i=nearest.index;i<route.geometry.coordinates.length-1;i++){
  const a=route.geometry.coordinates[i],b=route.geometry.coordinates[i+1];
  if(a&&b)total+=haversineMeters({lat:a[1],lon:a[0]},{lat:b[1],lon:b[0]});
 }
 return Math.max(0,Math.min(route.distance,total));
}
function arrivalTimeLabel(seconds:number){
 const date=new Date(Date.now()+Math.max(0,seconds)*1000);
 return date.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
}
function RealRouteMap({routeData,destination,livePosition,isNavigating}:any){
 const allCoordinates=routeData.geometry.coordinates as [number,number][];
 const nearestLive=livePosition?nearestRoutePoint(livePosition,allCoordinates):{index:0,distance:0};
 // Во время следования показываем участок впереди автомобиля, а не весь длинный маршрут.
 const visibleStartIndex=isNavigating&&livePosition?Math.max(0,nearestLive.index-3):0;
 const visibleEndIndex=isNavigating&&livePosition?Math.min(allCoordinates.length,nearestLive.index+55):allCoordinates.length;
 const coordinates=allCoordinates.slice(visibleStartIndex,visibleEndIndex);
 const mercator=(lon:number,lat:number)=>({x:lon*Math.PI/180,y:Math.log(Math.tan(Math.PI/4+Math.max(-85,Math.min(85,lat))*Math.PI/360))});
 const projected=coordinates.map(([lon,lat])=>mercator(lon,lat));
 if(livePosition)projected.push(mercator(livePosition.lon,livePosition.lat));
 const minX=Math.min(...projected.map(p=>p.x)),maxX=Math.max(...projected.map(p=>p.x));
 const minY=Math.min(...projected.map(p=>p.y)),maxY=Math.max(...projected.map(p=>p.y));
 const padX=Math.max((maxX-minX)*.16,.00008),padY=Math.max((maxY-minY)*.2,.00008);
 const bounds={minX:minX-padX,maxX:maxX+padX,minY:minY-padY,maxY:maxY+padY};
 const isPortraitDevice=typeof window!=='undefined'&&window.matchMedia('(max-width: 650px)').matches;
 const width=1000,height=isPortraitDevice?650:430;
 const scale=Math.min(900/(bounds.maxX-bounds.minX),(isPortraitDevice?565:350)/(bounds.maxY-bounds.minY));
 const usedW=(bounds.maxX-bounds.minX)*scale,usedH=(bounds.maxY-bounds.minY)*scale;
 const offsetX=(width-usedW)/2,offsetY=(height-usedH)/2;
 const xy=(lon:number,lat:number)=>{const p=mercator(lon,lat);return {x:offsetX+(p.x-bounds.minX)*scale,y:height-offsetY-(p.y-bounds.minY)*scale}};
 const points=coordinates.map(([lon,lat])=>{const p=xy(lon,lat);return `${p.x.toFixed(1)},${p.y.toFixed(1)}`}).join(' ');
 const start=xy(routeData.start[0],routeData.start[1]),end=xy(routeData.end[0],routeData.end[1]);
 const inside=(p:{x:number;y:number})=>p.x>=0&&p.x<=width&&p.y>=0&&p.y<=height;
 const live=livePosition?xy(livePosition.lon,livePosition.lat):null;
 const maneuvers=(routeData.steps||[]).filter((step:any)=>step.distance>20&&step.routeIndex>=visibleStartIndex&&step.routeIndex<visibleEndIndex).map((step:any)=>({step,...xy(step.location[0],step.location[1])})).filter((item:any)=>inside(item));
 return <div className={`real-navigation-map ${isNavigating?'is-following':''}`}>
  <div className="real-navigation-map-label"><span><i/> {isNavigating?'Участок дороги впереди вас':'Фактический автомобильный маршрут'}</span><span>{destination?.name||'Выбранная парковка'}</span></div>
  <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Реальный дорожный маршрут до ${destination?.name||'парковки'}`}>
   <defs><pattern id="navGrid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#1c3555" strokeWidth=".8" opacity=".7"/></pattern><filter id="navGlow"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
   <rect width={width} height={height} rx="12" fill="#09172b"/><rect width={width} height={height} rx="12" fill="url(#navGrid)"/>
   <polyline points={points} fill="none" stroke="#061020" strokeWidth="19" strokeLinecap="round" strokeLinejoin="round"/>
   <polyline points={points} fill="none" stroke="#75a6ff" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" filter="url(#navGlow)"/>
   <polyline points={points} fill="none" stroke="#e3edff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2 10" opacity=".95"/>
   {maneuvers.map((item:any,index:number)=><g key={index}><circle cx={item.x} cy={item.y} r="6" fill="#d5e3ff" stroke="#31588c" strokeWidth="2"/><text x={item.x+9} y={item.y-9} fill="#cbdcff" fontSize="10" fontWeight="600" paintOrder="stroke" stroke="#09172b" strokeWidth="3">{String(item.step.road||'').slice(0,24)}</text></g>)}
   {!isNavigating&&inside(start)&&<><circle cx={start.x} cy={start.y} r="11" fill="#f1bd58" stroke="#08172b" strokeWidth="4"/><text x={start.x+14} y={start.y-12} fill="#f8d48a" fontSize="13" fontWeight="700" paintOrder="stroke" stroke="#09172b" strokeWidth="3">СТАРТ</text></>}
   {inside(end)&&<><circle cx={end.x} cy={end.y} r="12" fill="#31d6a0" stroke="#08172b" strokeWidth="4"/><text x={end.x+14} y={end.y-12} fill="#69e4ba" fontSize="13" fontWeight="700" paintOrder="stroke" stroke="#09172b" strokeWidth="3">ФИНИШ</text></>}
   {live&&<><circle cx={live.x} cy={live.y} r="20" fill="#6ea3ff" opacity=".2"/><circle cx={live.x} cy={live.y} r="9" fill="#72a7ff" stroke="#fff" strokeWidth="2.5"/><text x={live.x+13} y={live.y+24} fill="#dce8ff" fontSize="12" fontWeight="700" paintOrder="stroke" stroke="#09172b" strokeWidth="3">ВЫ ЗДЕСЬ</text></>}
  </svg>
  <div className="real-navigation-map-footer"><span>Маршрут показан внутри Parking Manager · расчёт: OSRM</span><span>Данные дорог © OpenStreetMap contributors</span></div>
 </div>;
}
function LeafletSatelliteMap({lots,selectedLotId,onSelect,routeData,livePosition}:any){
 const mapElement=useRef<HTMLDivElement|null>(null);
 const mapInstance=useRef<any>(null);
 const markerLayer=useRef<any>(null);
 const routeLayer=useRef<any>(null);
 const liveLayer=useRef<any>(null);
 const [mapReady,setMapReady]=useState(false);
 useEffect(()=>{
  let alive=true;
  const load=async()=>{
   if(!document.querySelector('link[data-pm-leaflet]')){const link=document.createElement('link');link.rel='stylesheet';link.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';link.dataset.pmLeaflet='1';document.head.appendChild(link)}
   if(!(window as any).L){await new Promise<void>((resolve,reject)=>{const existing=document.querySelector('script[data-pm-leaflet]') as HTMLScriptElement|null;if(existing){existing.addEventListener('load',()=>resolve(),{once:true});existing.addEventListener('error',()=>reject(new Error('Leaflet не загрузился')),{once:true});return}const script=document.createElement('script');script.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';script.dataset.pmLeaflet='1';script.onload=()=>resolve();script.onerror=()=>reject(new Error('Leaflet не загрузился'));document.body.appendChild(script)})}
   if(!alive||!mapElement.current)return;
   const L=(window as any).L;
   const map=L.map(mapElement.current,{zoomControl:true,scrollWheelZoom:true,touchZoom:true,dragging:true,doubleClickZoom:true}).setView([55.7512,37.6184],11);
   L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Imagery © Esri, Maxar, Earthstar Geographics'}).addTo(map);
   mapInstance.current=map;markerLayer.current=L.layerGroup().addTo(map);routeLayer.current=L.layerGroup().addTo(map);liveLayer.current=L.layerGroup().addTo(map);setMapReady(true);
   window.setTimeout(()=>map.invalidateSize(),150);
  };
  load().catch(()=>{if(alive&&mapElement.current)mapElement.current.innerHTML='<div class="satellite-map-error">Не удалось загрузить спутниковые снимки. Проверьте интернет и попробуйте снова.</div>'});
  return ()=>{alive=false;setMapReady(false);if(mapInstance.current){mapInstance.current.remove();mapInstance.current=null;markerLayer.current=null;routeLayer.current=null;liveLayer.current=null}};
 },[]);
 useEffect(()=>{
  const map=mapInstance.current,layer=markerLayer.current,L=(window as any).L;if(!map||!layer||!L)return;
  layer.clearLayers();
  (lots||[]).forEach((lot:any)=>{if(!Number.isFinite(Number(lot.lat))||!Number.isFinite(Number(lot.lon)))return;const chosen=Number(lot.id)===Number(selectedLotId);const marker=L.circleMarker([Number(lot.lat),Number(lot.lon)],{radius:chosen?9:6,color:'#071326',weight:2,fillColor:chosen?'#77a4ff':Number(lot.free)>0?'#31d6a0':'#ef6678',fillOpacity:1}).addTo(layer);marker.bindPopup(`<b>${String(lot.name||'Парковка').replace(/[<>]/g,'')}</b><br>${String(lot.address||'').replace(/[<>]/g,'')}<br>${Number(lot.free)||0} свободно · ${Number(lot.totalSpaces)||0} мест`);marker.on('click',()=>onSelect(lot.id));});
 },[mapReady,lots,selectedLotId,onSelect]);
 useEffect(()=>{
  const map=mapInstance.current,layer=routeLayer.current,L=(window as any).L;if(!map||!layer||!L)return;
  layer.clearLayers();
  if(routeData?.geometry?.coordinates?.length){const line=L.polyline(routeData.geometry.coordinates.map((point:any)=>[Number(point[1]),Number(point[0])]),{color:'#75a6ff',weight:6,opacity:.95}).addTo(layer);map.fitBounds(line.getBounds(),{padding:[42,42],maxZoom:16});}
 },[mapReady,routeData]);
 useEffect(()=>{
  const layer=liveLayer.current,L=(window as any).L;if(!layer||!L)return;
  layer.clearLayers();if(livePosition)L.circleMarker([livePosition.lat,livePosition.lon],{radius:8,color:'#fff',weight:3,fillColor:'#347dff',fillOpacity:1}).addTo(layer);
 },[mapReady,livePosition]);
 return <div className="satellite-map-shell"><div ref={mapElement} className="satellite-map" aria-label="Спутниковая карта Москвы с парковками"/><div className="satellite-map-hint">Перемещайте карту пальцем, масштабируйте двумя пальцами</div></div>;
}

function MoscowMap({lots,selectedLotId,onSelect,routeLotId,routeOrigin}:any){
 const [zoom,setZoom]=useState(1);
 const [zoomOrigin,setZoomOrigin]=useState({x:500,y:310});
 const [panOffset,setPanOffset]=useState({x:0,y:0});
 const dragRef=useRef<{x:number;y:number;panX:number;panY:number}|null>(null);
 const width=1000,height=620;
 const safeLots=(lots||MOSCOW_PARKINGS).filter((lot:any)=>Number.isFinite(Number(lot.lat))&&Number.isFinite(Number(lot.lon)));
 const minLon=Math.min(...safeLots.map((lot:any)=>Number(lot.lon)),37.6184)-0.025;
 const maxLon=Math.max(...safeLots.map((lot:any)=>Number(lot.lon)),37.6184)+0.025;
 const minLat=Math.min(...safeLots.map((lot:any)=>Number(lot.lat)),55.7512)-0.018;
 const maxLat=Math.max(...safeLots.map((lot:any)=>Number(lot.lat)),55.7512)+0.018;
 const project=(lat:number,lon:number)=>({x:58+(lon-minLon)/(maxLon-minLon||1)*884,y:48+(maxLat-lat)/(maxLat-minLat||1)*520});
 const center=project(55.7512,37.6184);
 const activeLot=safeLots.find((lot:any)=>lot.id===(routeLotId||selectedLotId))||safeLots[0]||MOSCOW_PARKINGS[11];
 const activePoint=project(activeLot.lat,activeLot.lon);
 const streetGrid=[
  ...Array.from({length:7},(_,r)=>`M 60 ${60+r*83} L 942 ${60+r*83}`),
  ...Array.from({length:10},(_,c)=>`M ${60+c*98} 60 L ${60+c*98} 558`)
 ];
 const roads=[
  'M 90 140 C 220 110 300 180 420 145 S 690 105 900 160',
  'M 75 235 C 210 205 310 250 440 225 S 710 200 930 245',
  'M 60 340 C 210 310 300 360 440 330 S 720 300 950 355',
  'M 85 455 C 220 420 330 475 470 445 S 730 420 920 470',
  'M 180 65 C 150 190 230 260 190 370 S 210 500 260 570',
  'M 360 45 C 330 170 390 250 355 365 S 380 500 420 585',
  'M 565 45 C 520 170 600 255 560 370 S 590 500 625 585',
  'M 770 55 C 720 180 800 260 760 375 S 785 500 835 570',
 ];
 const minorRoads=[
  'M 100 185 L 890 405','M 110 390 L 880 190','M 270 70 L 690 560','M 680 70 L 300 560',
  'M 120 285 C 330 250 590 285 880 320','M 160 510 C 370 390 630 390 860 510',
  'M 450 70 C 420 210 480 380 450 550','M 850 120 C 650 230 600 390 700 550'
 ];
 const river='M 65 390 C 145 350 175 390 240 365 S 340 330 405 350 S 510 420 585 390 S 700 325 760 350 S 855 405 945 365';
 return <div className="moscow-map-visual" onPointerDown={event=>{if(event.pointerType==='mouse'&&event.button!==0)return;dragRef.current={x:event.clientX,y:event.clientY,panX:panOffset.x,panY:panOffset.y};event.currentTarget.setPointerCapture?.(event.pointerId)}} onPointerMove={event=>{if(!dragRef.current)return;const dx=event.clientX-dragRef.current.x,dy=event.clientY-dragRef.current.y;if(Math.abs(dx)+Math.abs(dy)>3)setPanOffset({x:dragRef.current.panX+dx,y:dragRef.current.panY+dy})}} onPointerUp={()=>{dragRef.current=null}} onPointerCancel={()=>{dragRef.current=null}} onWheel={event=>{event.preventDefault();const rect=event.currentTarget.getBoundingClientRect();setZoomOrigin({x:Math.max(0,Math.min(width,((event.clientX-rect.left)/rect.width)*width)),y:Math.max(0,Math.min(height,((event.clientY-rect.top)/rect.height)*height))});setZoom(current=>Math.max(.7,Math.min(3.2,Number((current+(event.deltaY<0?.14:-.14)).toFixed(2)))));}}>
  <div className="map-zoom-controls"><button onClick={()=>{setZoomOrigin({x:500,y:310});setZoom(z=>Math.min(3.2,Number((z+.15).toFixed(2))))}} aria-label="Увеличить карту">+</button><button onClick={()=>{setZoomOrigin({x:500,y:310});setZoom(z=>Math.max(.7,Number((z-.15).toFixed(2))))}} aria-label="Уменьшить карту">−</button><button onClick={()=>{setZoomOrigin({x:500,y:310});setZoom(1)}} aria-label="Сбросить масштаб">↺</button></div>
  <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Собственная схема Москвы с ${safeLots.length} отметками парковок`}>
   <defs>
    <pattern id="cityGrid" width="34" height="34" patternUnits="userSpaceOnUse"><path d="M 34 0 L 0 0 0 34" fill="none" stroke="#183052" strokeWidth=".7" opacity=".55"/></pattern>
    <linearGradient id="cityFill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#102747"/><stop offset="1" stopColor="#0a1930"/></linearGradient>
    <filter id="pinGlow"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
   </defs>
   <rect width="1000" height="620" fill="url(#cityFill)"/><rect width="1000" height="620" fill="url(#cityGrid)"/>
   <g transform={`translate(${panOffset.x} ${panOffset.y}) translate(${zoomOrigin.x} ${zoomOrigin.y}) scale(${zoom}) translate(${-zoomOrigin.x} ${-zoomOrigin.y})`}>
    <path d="M 100 90 C 220 35 390 55 500 35 C 690 55 840 85 925 190 L 950 420 C 890 545 730 570 590 585 C 400 600 205 570 90 470 C 40 350 40 200 100 90Z" fill="#122b49" stroke="#29466b" strokeWidth="3" opacity=".72"/>
    <g fill="#1a3554" opacity=".7"><path d="M120 120 L280 90 330 210 190 250Z"/><path d="M380 90 L520 85 540 205 400 220Z"/><path d="M620 95 L800 115 790 235 640 215Z"/><path d="M120 285 L285 265 300 390 120 410Z"/><path d="M380 270 L540 250 560 390 390 405Z"/><path d="M650 275 L850 260 875 405 670 420Z"/><path d="M220 440 L390 425 420 545 240 540Z"/><path d="M520 445 L720 430 760 540 550 560Z"/></g>
    <g fill="none" stroke="#29496e" strokeWidth="9" strokeLinecap="round" opacity=".95">{roads.map((d,i)=><path key={i} d={d}/>)}</g>
    <g fill="none" stroke="#527092" strokeWidth="2.2" strokeLinecap="round" opacity=".8">{roads.map((d,i)=><path key={i} d={d}/>)}</g>
    <g fill="none" stroke="#203c60" strokeWidth="3" strokeLinecap="round" opacity=".9">{minorRoads.map((d,i)=><path key={i} d={d}/>)}</g>\n    <g fill="none" stroke="#315172" strokeWidth="4.5" strokeLinecap="round" opacity=".48">{streetGrid.map((d,i)=><path key={`grid-${i}`} d={d}/>)}</g>
    <path d={river} fill="none" stroke="#1b6684" strokeWidth="24" strokeLinecap="round" opacity=".75"/><path d={river} fill="none" stroke="#3185a3" strokeWidth="2" strokeLinecap="round" opacity=".9"/>
    <ellipse cx="505" cy="320" rx="155" ry="105" fill="none" stroke="#7392b5" strokeWidth="4" strokeDasharray="8 7" opacity=".8"/>
    <ellipse cx="505" cy="320" rx="245" ry="175" fill="none" stroke="#456889" strokeWidth="3" opacity=".75"/>
    <g fill="#3c795f" opacity=".65"><path d="M90 250 Q140 210 185 250 Q190 300 140 315Z"/><path d="M780 420 Q850 390 900 440 Q875 500 810 490Z"/><path d="M315 475 Q365 450 405 485 Q390 535 335 530Z"/><path d="M700 125 Q745 100 780 145 Q765 185 720 180Z"/></g>
    <circle cx={center.x} cy={center.y} r="7" fill="#d8e8ff" stroke="#10213d" strokeWidth="4"/>
    {safeLots.map((lot:any)=>{const pt=project(lot.lat,lot.lon);const isActive=lot.id===selectedLotId;const pinColor=Number(lot.free)>0?'#31d6a0':'#ef6678';return <g key={lot.id} transform={`translate(${pt.x} ${pt.y})`} onClick={()=>onSelect(lot.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' ')onSelect(lot.id)}} role="button" tabIndex={0} aria-label={`${lot.name}: ${lot.free>0?`свободно ${lot.free} из ${lot.totalSpaces}`:'свободных мест нет'} (демо)`} style={{cursor:'pointer'}}>
      <title>{lot.name} · {lot.free>0?`свободно ${lot.free} из ${lot.totalSpaces}`:'мест нет'} · демонстрационная загруженность</title>
      {isActive&&<circle r="18" fill="#78a5ff" opacity=".22" filter="url(#pinGlow)"/>}
      <circle r={isActive?10:4.8} fill={isActive?'#78a5ff':pinColor} stroke="#071326" strokeWidth={isActive?2.5:1.2}/>
      {isActive&&<circle r="2.7" fill="#071326"/>}
    </g>})}
   </g>
  </svg>
 </div>;
}
function ParkingPage({spots,setSpots,selected,onSelect,query,setQuery,zone,setZone,favorites,onFavorite,onBook,onGoBooking,parkingName,setParkingName,address,setAddress,tariff,setTariff,selectedLotId,setSelectedLotId,vehicles,vehicleId,setVehicleId,onChipEntry,notify,onLotsChange}:any){
 const [routeLotId,setRouteLotId]=useState<number|null>(null);
 const [routeOrigin,setRouteOrigin]=useState<RouteOrigin>(null);
 const [routeData,setRouteData]=useState<DrivingRoute|null>(null);
 const [routeLoading,setRouteLoading]=useState(false);
 const [routeError,setRouteError]=useState('');
 const [isNavigating,setIsNavigating]=useState(false);
 const [livePosition,setLivePosition]=useState<RouteOrigin>(null);
 const [currentStepIndex,setCurrentStepIndex]=useState(0);
 const [offRoute,setOffRoute]=useState(false);
 const [voiceGuidance,setVoiceGuidance]=useState(true);
 const [voiceRate,setVoiceRate]=useState(0.92);
 const [voiceURI,setVoiceURI]=useState('');
 const [availableVoices,setAvailableVoices]=useState<SpeechSynthesisVoice[]>([]);
 const [mapMode,setMapMode]=useState<'vector'|'satellite'>('vector');
 const [fullNavigation,setFullNavigation]=useState(false);
 const [gpsAccuracy,setGpsAccuracy]=useState<number|null>(null);
 const lastAnnouncedStepRef=useRef(-1);
 const watchIdRef=useRef<number|null>(null);
 const wakeLockRef=useRef<any>(null);
 const routeDataRef=useRef<DrivingRoute|null>(null);
 const lastRerouteRef=useRef(0);
 const [favoritesOnly,setFavoritesOnly]=useState(false);
 const [spotQuery,setSpotQuery]=useState('');
 const readParkingCache=()=>{try{const raw=localStorage.getItem('pm2_city_parkings_cache');const parsed=raw?JSON.parse(raw):null;return Array.isArray(parsed)&&parsed.length?parsed.map((lot:any)=>normalizeParkingRecord(lot)):MOSCOW_PARKINGS.map((lot:any)=>withDemoAvailability(lot))}catch{return MOSCOW_PARKINGS.map((lot:any)=>withDemoAvailability(lot))}};
 const [allLots,setAllLots]=useState<any[]>(readParkingCache);
 useEffect(()=>{onLotsChange?.(allLots)},[allLots]);
 useEffect(()=>{
  let alive=true;
  fetch('/api/parkings').then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()}).then((data:any)=>{
   const items=Array.isArray(data?.parkings)?data.parkings:[];
   const mapped=items.map((p:any)=>normalizeParkingRecord({...p,source:'open-data'})).filter((p:any)=>Number.isFinite(p.id)&&Number.isFinite(p.lat)&&Number.isFinite(p.lon));
   if(!mapped.length)throw new Error('Пустой набор парковок');
   if(alive){setAllLots(mapped);try{localStorage.setItem('pm2_city_parkings_cache',JSON.stringify(mapped))}catch{}}
  }).catch(()=>{if(alive){setAllLots(readParkingCache())}});
  return ()=>{alive=false};
 },[]);
 useEffect(()=>{
  if(!allLots.length)return;
  const current=allLots.find((p:any)=>p.id===selectedLotId)||allLots[0];
  if(Number(current.id)!==Number(selectedLotId))setSelectedLotId(current.id);
  setParkingName(current.name);
  setAddress(`Москва, ${cleanMoscowAddress(current.address||current.name)}`);
  setTariff(current.price??200);
  if(Number(spots[0]?.parkingId||-1)!==Number(current.id)){
   setSpots(readParkingSpotsForLot(current.id));
   onSelect(null);
   setZone('A');
  }
 },[allLots,selectedLotId]);
 const activeLot=allLots.find((lot:any)=>Number(lot.id)===Number(selectedLotId))||allLots[0]||MOSCOW_PARKINGS[11];
 const visible=spots.filter((s:Spot)=>`${spotName(s)} ${s.type} ${s.status}`.toLowerCase().includes(spotQuery.toLowerCase())&&(zone==='Все зоны'||s.zone===zone));
 const lots=allLots.filter((lot:any)=>`${lot.name} ${lot.address}`.toLowerCase().includes(query.toLowerCase())&&(!favoritesOnly||favorites.includes(lot.name)));
 const searchMatches=query.trim()?lots.slice(0,5):[];
 const sel=spots.find((s:Spot)=>s.id===selected);
 const selectedVehicle=vehicles.find((v:Vehicle)=>v.id===vehicleId);
 const mapLots=allLots.map((lot:any)=>{const lotSpots=Number(lot.id)===Number(selectedLotId)?spots:readParkingSpotsForLot(Number(lot.id));const totalSpaces=lotSpots.length;const occupied=lotSpots.filter((spot:Spot)=>spot.status==='Занято').length;const reserved=lotSpots.filter((spot:Spot)=>spot.status==='Забронировано').length;return {...lot,totalSpaces,occupied,reserved,free:Math.max(0,totalSpaces-occupied-reserved)}});
 const priceText=(lot:any)=>lot?.price==null?'тариф не указан':`${money(lot.price)} / час`;
 const freeCount=spots.filter((s:Spot)=>s.status==='Свободно').length;
 const occupiedCount=spots.filter((s:Spot)=>s.status==='Занято').length;
 const reservedCount=spots.filter((s:Spot)=>s.status==='Забронировано').length;
 const currentZoneSpots=zone==='Все зоны'?visible:visible.filter((s:Spot)=>s.zone===zone);
 const zoneA=spots.filter((s:Spot)=>s.zone==='A');
 const zoneB=spots.filter((s:Spot)=>s.zone==='B');
 const zoneStats=(list:Spot[])=>({free:list.filter(s=>s.status==='Свободно').length,total:list.length});
 useEffect(()=>{
  if(!('speechSynthesis' in window))return;
  const refresh=()=>{const voices=window.speechSynthesis.getVoices();setAvailableVoices(voices);if(!voiceURI){const russian=voices.find(v=>/^ru([_-]|$)/i.test(v.lang));if(russian)setVoiceURI(russian.voiceURI)}};
  refresh();window.speechSynthesis.onvoiceschanged=refresh;
  return ()=>{window.speechSynthesis.onvoiceschanged=null};
 },[]);
 const speakNavigationText=(text:string)=>{
  if(!('speechSynthesis' in window)||typeof SpeechSynthesisUtterance==='undefined'){notify('Озвучка не поддерживается этим браузером.');return}
  try{
   const utterance=new SpeechSynthesisUtterance(text);
   utterance.lang='ru-RU';utterance.rate=voiceRate;utterance.pitch=1;utterance.volume=1;
   const voices=window.speechSynthesis.getVoices();
   const chosenVoice=voices.find(v=>v.voiceURI===voiceURI)||voices.find(v=>/^ru([_-]|$)/i.test(v.lang));
   if(chosenVoice)utterance.voice=chosenVoice;
   window.speechSynthesis.cancel();window.speechSynthesis.speak(utterance);
  }catch{notify('Не удалось запустить голосовую подсказку.')}
 };
 const acquireWakeLock=async()=>{
  try{const wakeLockApi=(navigator as any).wakeLock;if(wakeLockApi?.request)wakeLockRef.current=await wakeLockApi.request('screen')}catch{/* Screen Wake Lock is optional; iOS support depends on Safari version and app state. */}
 };
 const releaseWakeLock=()=>{try{wakeLockRef.current?.release?.()}catch{}wakeLockRef.current=null};
 const stopNavigation=()=>{
  if(watchIdRef.current!==null&&navigator.geolocation){navigator.geolocation.clearWatch(watchIdRef.current);watchIdRef.current=null}
  setIsNavigating(false);
  releaseWakeLock();
  if('speechSynthesis' in window)window.speechSynthesis.cancel();
  lastAnnouncedStepRef.current=-1;
 };
 useEffect(()=>()=>{if(watchIdRef.current!==null&&navigator.geolocation)navigator.geolocation.clearWatch(watchIdRef.current);releaseWakeLock();if('speechSynthesis' in window)window.speechSynthesis.cancel()},[]);
 const buildRoute=async(origin:{lat:number;lon:number},target:any,quiet=false)=>{
  if(!target||!Number.isFinite(Number(target.lat))||!Number.isFinite(Number(target.lon)))throw new Error('У выбранной парковки нет координат для построения маршрута.');
  if(!quiet){setRouteLoading(true);setRouteError('')}
  try{
   const result=await requestDrivingRoute(origin,{lat:Number(target.lat),lon:Number(target.lon)});
   routeDataRef.current=result;setRouteData(result);setRouteOrigin(origin);setRouteLotId(Number(target.id));setCurrentStepIndex(result.steps.length>1?1:0);setOffRoute(false);
   if(!quiet)notify(`Маршрут построен: ${formatRouteDistance(result.distance)}, примерно ${formatRouteDuration(result.duration)}.`);
   return result;
  }catch(error:any){
   if(!quiet)setRouteError(error?.message||'Не удалось построить маршрут.');
   throw error;
  }finally{if(!quiet)setRouteLoading(false)}
 };
 const clearRoute=()=>{
  setFullNavigation(false);stopNavigation();routeDataRef.current=null;setRouteData(null);setRouteLotId(null);setRouteOrigin(null);setLivePosition(null);setRouteError('');setRouteLoading(false);setCurrentStepIndex(0);setOffRoute(false);
 };
 const selectLot=(value:any)=>{
  const lot=typeof value==='number'?allLots.find((item:any)=>Number(item.id)===Number(value)):value;
  if(!lot)return;
  clearRoute();
  setSelectedLotId(lot.id);
  setSpots(readParkingSpotsForLot(lot.id));
  onSelect(null);
  setZone('A');setSpotQuery('');
  setParkingName(lot.name);
  setAddress(`Москва, ${cleanMoscowAddress(lot.address||lot.name)}`);
  setTariff(lot.price??200);
 };
 const chooseLot=(lot:any)=>{selectLot(lot);notify(lot.price==null?`Выбрана ${lot.name}. В учебной версии используется демонстрационный тариф 200 ₽/час.`:`Выбрана ${lot.name}. Тариф ${money(lot.price)} в час.`)};
 const showRoute=(targetLot:any=activeLot)=>{
  if(routeLoading)return;
  stopNavigation();routeDataRef.current=null;setRouteData(null);setRouteError('');setRouteLotId(targetLot.id);setRouteLoading(true);setCurrentStepIndex(0);setOffRoute(false);setGpsAccuracy(null);
  if(!navigator.geolocation){setRouteLoading(false);setRouteError('Этот браузер не поддерживает определение геопозиции.');return}
  navigator.geolocation.getCurrentPosition(async position=>{
   const origin={lat:position.coords.latitude,lon:position.coords.longitude};
   setGpsAccuracy(Number.isFinite(position.coords.accuracy)?position.coords.accuracy:null);
   setRouteOrigin(origin);setLivePosition(origin);
   try{await buildRoute(origin,targetLot)}catch(error:any){setRouteError(error?.message||'Не удалось построить маршрут.')}
  },error=>{
   setRouteLoading(false);
   const message=error?.code===1?'Доступ к геопозиции запрещён. Разреши местоположение для localhost в настройках браузера.':error?.code===2?'Не удалось определить геопозицию устройства.':'Истекло время ожидания геопозиции. Попробуй ещё раз.';
   setRouteError(message);
  },{enableHighAccuracy:true,timeout:15000,maximumAge:5000});
 };
 const startNavigation=()=>{
  if(isNavigating)return;
  if(!routeDataRef.current||!routeLotId){notify('Сначала построй маршрут до парковки.');return}
  if(!navigator.geolocation){setRouteError('Геопозиция не поддерживается этим браузером.');return}
  if(watchIdRef.current!==null)navigator.geolocation.clearWatch(watchIdRef.current);
  const target=allLots.find((lot:any)=>Number(lot.id)===Number(routeLotId))||activeLot;
  watchIdRef.current=navigator.geolocation.watchPosition(async position=>{
   const current={lat:position.coords.latitude,lon:position.coords.longitude};
   setGpsAccuracy(Number.isFinite(position.coords.accuracy)?position.coords.accuracy:null);
   setLivePosition(current);
   const route=routeDataRef.current;
   if(!route)return;
   const nearest=nearestRoutePoint(current,route.geometry.coordinates);
   setOffRoute(nearest.distance>75);
   const nextStep=route.steps.findIndex((step:any)=>step.routeIndex>=nearest.index+2);
   setCurrentStepIndex(nextStep<0?Math.max(0,route.steps.length-1):nextStep);
   if(nearest.distance>90&&Date.now()-lastRerouteRef.current>30000){
    lastRerouteRef.current=Date.now();
    try{await buildRoute(current,target,true);notify('Маршрут перестроен от вашего нового местоположения.')}catch(error:any){setRouteError(error?.message||'Не удалось перестроить маршрут.')}
   }
  },error=>{
   const message=error?.code===1?'Браузер запретил доступ к геопозиции.': 'Сигнал геопозиции временно потерян.';
   setRouteError(message);stopNavigation();
  },{enableHighAccuracy:true,timeout:20000,maximumAge:3000});
  lastRerouteRef.current=Date.now();setIsNavigating(true);void acquireWakeLock();
  // Start speech directly inside the user's tap; iOS Safari may require a gesture to unlock speech output.
  lastAnnouncedStepRef.current=currentStepIndex;
  if(voiceGuidance)speakNavigationText(nextDirection?.instruction||`Навигация запущена. До парковки ${target.name||'осталось следовать маршруту'}.`);
  notify('Навигация запущена. Не блокируйте экран во время движения в веб-версии.');
 };
 useEffect(()=>{
  if(!isNavigating)return;
  const onVisibility=()=>{if(document.visibilityState==='visible')void acquireWakeLock()};
  document.addEventListener('visibilitychange',onVisibility);
  return ()=>document.removeEventListener('visibilitychange',onVisibility);
 },[isNavigating]);
 const directionSteps=routeData?.steps||[];
 const nextDirection=directionSteps[Math.min(currentStepIndex,directionSteps.length-1)];
 const distanceToNext=nextDirection&&livePosition&&routeData?distanceAlongRouteToStep(livePosition,routeData,nextDirection):null;
 const routeRemaining=routeData?remainingRouteMeters(livePosition,routeData):0;
 const routeRemainingSeconds=routeData&&routeData.distance>0?routeData.duration*(routeRemaining/routeData.distance):0;
 const isIOSDevice=typeof navigator!=='undefined'&&/iPhone|iPad|iPod/i.test(navigator.userAgent);
 const maneuverText=String(nextDirection?.instruction||'').toLowerCase();
 const ManeuverIcon=/налево|левый/.test(maneuverText)?CornerUpLeft:/направо|правый/.test(maneuverText)?CornerUpRight:/развернитесь|разворот/.test(maneuverText)?RotateCcw:ArrowUp;
 useEffect(()=>{
  if(!isNavigating||!voiceGuidance||!nextDirection){if(!isNavigating&&'speechSynthesis' in window)window.speechSynthesis.cancel();return}
  if(lastAnnouncedStepRef.current===currentStepIndex)return;
  lastAnnouncedStepRef.current=currentStepIndex;
  speakNavigationText(nextDirection.instruction);
 },[isNavigating,voiceGuidance,currentStepIndex,nextDirection?.instruction]);
 return <div className={`content ${isNavigating?'mobile-navigation-mode':''} ${fullNavigation?'navigation-fullscreen':''}`}>
  {isNavigating&&routeData&&<section className="mobile-drive-turn"><div className="mobile-drive-turn-top"><span className="mobile-drive-live"><i/> НАВИГАЦИЯ АКТИВНА</span><span>{gpsAccuracy!==null?`GPS ±${Math.round(gpsAccuracy)} м`:'GPS подключается'}</span><button className="nav-fullscreen-toggle" onClick={()=>setFullNavigation(v=>!v)}>{fullNavigation?'Свернуть':'На весь экран'}</button></div><div className="mobile-drive-turn-main"><div className="mobile-drive-arrow"><ManeuverIcon size={32}/></div><div><small>{distanceToNext!==null?`ЧЕРЕЗ ${formatRouteDistance(distanceToNext)}`:'СЛЕДУЮЩИЙ МАНЁВР'}</small><b>{nextDirection?.instruction||'Продолжайте движение по маршруту'}</b><span>{nextDirection?.road||'Следуйте по маршруту'}</span></div></div></section>}
  <div className="page-intro"><h2>Парковки на карте Москвы</h2><p>Выберите парковку, просмотрите места и постройте маршрут</p></div>
  <div className="map-search parking-search-main"><Search size={17}/><input placeholder="Найти парковку по названию или адресу…" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button className="search-clear" onClick={()=>setQuery('')} title="Очистить поиск"><X size={15}/></button>}</div>
  {query.trim()&&<div className="parking-search-suggestions">{searchMatches.map((lot:any)=><button key={lot.id} onClick={()=>{selectLot(lot);setQuery('')}}><MapPin size={14}/><span><b>{lot.name}</b><small>{lot.address}</small></span><ChevronRight size={15}/></button>)}{!searchMatches.length&&<p>Ничего не найдено. Проверьте название или адрес.</p>}</div>}
  <section className="city-map-card">
   <div className="city-map-head"><b><MapPinned size={17}/> Карта парковок Москвы</b><div className="map-mode-switch"><button className={mapMode==='vector'?'active':''} onClick={()=>setMapMode('vector')}>Схема</button><button className={mapMode==='satellite'?'active':''} onClick={()=>setMapMode('satellite')}>Спутник</button><span>{allLots.length} точек</span></div></div>
   {mapMode==='satellite'?<LeafletSatelliteMap lots={mapLots} selectedLotId={selectedLotId} onSelect={selectLot} routeData={routeData} livePosition={livePosition}/>:routeData&&routeLotId?<RealRouteMap routeData={routeData} destination={activeLot} livePosition={livePosition} isNavigating={isNavigating}/>:<MoscowMap lots={mapLots} selectedLotId={selectedLotId} onSelect={selectLot} routeLotId={null} routeOrigin={null}/>}
   <div className="map-selected-summary"><div><b>{activeLot.name}</b><span>{activeLot.address} · {priceText(activeLot)}</span><span>{freeCount} свободно · {occupiedCount} занято · {reservedCount} резерв · {spots.length} мест на этой парковке</span></div><button className="primary-btn" onClick={()=>{chooseLot(activeLot);onGoBooking()}}>Забронировать здесь</button><button className="small-action" disabled={routeLoading} onClick={()=>showRoute(activeLot)} title="Построить автомобильный маршрут по дорогам"><Navigation size={16}/></button></div>
   {(routeLotId!==null)&&<div className="navigator-panel real-navigator-panel">
    <div className="navigator-heading"><span><Navigation size={17}/> Автомобильный навигатор</span><div><button onClick={()=>setFullNavigation(v=>!v)}>{fullNavigation?'Свернуть':'На весь экран'}</button><button onClick={clearRoute}><X size={15}/> Закрыть</button></div></div>
    <b>Ваше местоположение → {activeLot.name}</b>
    {routeLoading&&<div className="navigator-status"><RefreshCw size={15} className="spin"/> Определяем геопозицию и прокладываем маршрут по дорогам…</div>}
    {routeError&&<div className="navigator-error"><Info size={16}/><span>{routeError}</span><button onClick={()=>showRoute(activeLot)}>Повторить</button></div>}
    {routeData&&<>
     <div className="route-metrics"><div><small>Расстояние</small><b>{formatRouteDistance(routeData.distance)}</b></div><div><small>В пути</small><b>{formatRouteDuration(routeData.duration)}</b></div><div><small>Поворотов/этапов</small><b>{routeData.steps.length}</b></div></div>
     <div className="navigator-live-bar">{isNavigating?<><span className="live-dot"/> Навигация активна · GPS обновляется{offRoute&&<strong>Отклонение от маршрута</strong>}</>:<span>Маршрут рассчитан по реальным автомобильным дорогам. Нажми «Начать движение» для GPS-сопровождения и голосовых подсказок.</span>}</div>
     {nextDirection&&<div className="next-maneuver-card"><small>СЛЕДУЮЩЕЕ ДЕЙСТВИЕ</small><b>{nextDirection.instruction}</b><span>{distanceToNext!==null?`До манёвра: ${formatRouteDistance(distanceToNext)}`:(nextDirection.road||'Название дороги не указано')}</span><small>{nextDirection.road||'Название дороги не указано'}</small></div>}
     <div className="navigator-actions">{!isNavigating?<button className="primary-btn" onClick={startNavigation}><Navigation size={15}/> Начать движение</button>:<button className="secondary-btn" onClick={stopNavigation}><X size={15}/> Завершить навигацию</button>}<button className="secondary-btn" onClick={()=>showRoute(activeLot)}><RefreshCw size={15}/> Перестроить</button><button className="secondary-btn voice-guidance-toggle" onClick={()=>{lastAnnouncedStepRef.current=-1;setVoiceGuidance(v=>!v)}}>{voiceGuidance?<Volume2 size={15}/>:<VolumeX size={15}/>} Голос: {voiceGuidance?'включён':'выключен'}</button></div>
     <details className="route-instructions"><summary>Пошаговый маршрут ({routeData.steps.length})</summary><ol>{routeData.steps.map((step:any,index:number)=><li key={index} className={isNavigating&&index===currentStepIndex?'current-route-step':''}><span className="route-step-number">{index+1}</span><div><b>{step.instruction}</b><small>{step.road||'Дорога без названия'} · {formatRouteDistance(step.distance)}</small></div></li>)}</ol></details>
     <small className="routing-attribution">Для построения маршрута координаты геопозиции и парковки передаются маршрутизатору OSRM. Нужен интернет; данные о текущих пробках и временных перекрытиях не подключены. Настройте маршрут до начала поездки.</small>
     {isNavigating&&<div className="mobile-drive-controls"><div className="mobile-drive-eta"><div><small>ОСТАЛОСЬ</small><b>{formatRouteDistance(routeRemaining)}</b></div><div><small>ВРЕМЯ В ПУТИ</small><b>{formatRouteDuration(routeRemainingSeconds)}</b></div><div><small>ПРИБЫТИЕ</small><b>{arrivalTimeLabel(routeRemainingSeconds)}</b></div></div><div className="mobile-drive-control-row"><button className={`mobile-drive-voice ${voiceGuidance?'enabled':''}`} onClick={()=>setVoiceGuidance(v=>{const next=!v;if(!next&&'speechSynthesis' in window)window.speechSynthesis.cancel();else if(next&&nextDirection){lastAnnouncedStepRef.current=currentStepIndex;speakNavigationText(nextDirection.instruction)}return next})}>{voiceGuidance?<Volume2 size={19}/>:<VolumeX size={19}/>}<span>{voiceGuidance?'Озвучка включена':'Озвучка выключена'}</span></button><label className="mobile-drive-speed"><span>Скорость речи</span><select value={voiceRate} onChange={e=>setVoiceRate(Number(e.target.value))}><option value={0.82}>Медленно</option><option value={0.92}>Обычно</option><option value={1.08}>Быстро</option></select></label><label className="mobile-drive-speed mobile-drive-voice-select"><span>Голос</span><select value={voiceURI} onChange={e=>setVoiceURI(e.target.value)}><option value="">Автоматический</option>{availableVoices.map(v=><option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}</select></label><button className="mobile-drive-repeat" onClick={()=>nextDirection&&speakNavigationText(nextDirection.instruction)} title="Повторить подсказку"><Volume2 size={18}/><span>Повторить</span></button></div><button className="mobile-drive-stop" onClick={stopNavigation}><X size={18}/> Завершить навигацию</button><p className="mobile-drive-footnote">{isIOSDevice?'На iPhone веб-приложение может приостанавливать GPS при блокировке экрана или переходе в фон. Для непрерывной фоновой навигации потребуется нативное приложение iOS.':'Для стабильного GPS держите приложение открытым. При сворачивании браузер может ограничить обновления геопозиции.'} Bluetooth использует системный аудиовыход устройства.</p></div>}
    </>}
   </div>}
  </section>
  <div className="parking-layout">
   <section className="compact-spots-card">
    <div className="compact-spots-head"><div><h3>Места на выбранной парковке</h3><small>{spots.length} мест · каждая парковка имеет собственную схему</small></div><div className="compact-spots-total"><b>{freeCount}</b><span>свободно</span></div></div>
    <div className="zone-tabs">
     <button className={zone==='A'?'active':''} onClick={()=>setZone('A')}>Зона A <small>{zoneStats(zoneA).free}/{zoneStats(zoneA).total}</small></button>
     <button className={zone==='B'?'active':''} onClick={()=>setZone('B')}>Зона B <small>{zoneStats(zoneB).free}/{zoneStats(zoneB).total}</small></button>
     <button className={zone==='Все зоны'?'active':''} onClick={()=>setZone('Все зоны')}>Все <small>{freeCount}/{spots.length}</small></button>
    </div>
    <div className="map-search spot-search compact-spot-search"><Search size={15}/><input placeholder="Найти место: A01, B13, свободно…" value={spotQuery} onChange={e=>setSpotQuery(e.target.value)}/>{spotQuery&&<button className="search-clear" onClick={()=>setSpotQuery('')}><X size={14}/></button>}</div>
    <div className={`lot-card compact-lot-card ${zone==='Все зоны'?'all-zones-open':''}`}>
     {zone!=='B'&&<ParkingZone title="ЗОНА A" subtitle="ОСНОВНОЙ СЕКТОР" spots={visible.filter((s:Spot)=>s.zone==='A')} selected={selected} onSelect={onSelect}/>}
     {zone==='Все зоны'&&<div className="drive-aisle compact-drive-aisle"><span>↓</span><b>ПРОЕЗД</b><span>↓</span></div>}
     {zone!=='A'&&<ParkingZone title="ЗОНА B" subtitle="ДОПОЛНИТЕЛЬНЫЙ СЕКТОР" spots={visible.filter((s:Spot)=>s.zone==='B')} selected={selected} onSelect={onSelect}/>}
     <div className="legend-row compact-legend"><span><i className="free-dot"/>Свободно</span><span><i className="busy-dot"/>Занято</span><span><i className="reserved-dot"/>Забронировано</span></div>
    </div>
    {sel&&<div className="selected-card compact-selected-card"><div><b>Место {spotName(sel)}</b><span>{sel.type} · {money(tariff)} / час</span></div><button className="primary-btn" onClick={onBook}>Забронировать <ChevronRight size={15}/></button></div>}
   </section>
   <section className="vehicle-chip-card">
    <div className="chip-card-title"><div className="chip-car-icon"><CarFront size={21}/></div><div><h3>Въезд по чипу автомобиля</h3><small>Виртуальный пропуск Parking Manager</small></div></div>
    {vehicles.length?<><label className="field chip-vehicle-field">Автомобиль<select value={vehicleId} onChange={e=>setVehicleId(Number(e.target.value))}>{vehicles.map((v:Vehicle)=><option key={v.id} value={v.id}>{v.plate} · {v.make} {v.model}</option>)}</select></label><div className="virtual-chip-code"><KeyRound size={15}/><span>{selectedVehicle?.tagId||'Чип не назначен'}</span><b className={selectedVehicle?.chipEnabled===false?'chip-disabled':'chip-active'}>{selectedVehicle?.chipEnabled===false?'ВЫКЛЮЧЕН':'АКТИВЕН'}</b></div><button className="primary-btn full" disabled={selectedVehicle?.chipEnabled===false} onClick={onChipEntry}><Zap size={16}/> Распознать чип и запросить въезд</button></>:<div className="empty-state">Сначала добавьте автомобиль в профиле.</div>}
    <p>Симуляция: въезд разрешается только при оплаченном бронировании этой парковки на сегодня для выбранного автомобиля. Реальный RFID/NFC-шлагбаум не подключён.</p>
   </section>
  </div>
  <section className="moscow-lots"><div className="section-head"><h3 className="section-title">Каталог парковок ({lots.length})</h3><button className={`favorite-filter ${favoritesOnly?'active':''}`} onClick={()=>setFavoritesOnly(v=>!v)}><Heart size={14} fill={favoritesOnly?'currentColor':'none'}/>{favoritesOnly?'Показать все':`Избранное (${favorites.length})`}</button></div>{!lots.length&&<div className="empty-state">{favoritesOnly?'В избранном пока нет парковок':'По вашему запросу ничего не найдено'}</div>}<div className="parking-catalog-scroll">{lots.map((lot:any)=><article className={`moscow-lot ${lot.id===selectedLotId?'lot-active':''}`} key={lot.id} onClick={()=>selectLot(lot)}><img className="parking-lot-photo" src={lot.photo||parkingPhoto(lot.id)} alt={`Фото парковки ${lot.name}`} loading="lazy"/><div className="moscow-lot-info"><b>{lot.name}</b><span>{lot.address}</span><small>{lot.free??'—'} свободно по демо-модели · {lot.hours}</small></div><strong>{lot.price==null?'—':money(lot.price)}<small>{lot.price==null?'тариф':'/ час'}</small></strong><button className={`favorite-btn ${favorites.includes(lot.name)?'liked':''}`} onClick={e=>{e.stopPropagation();onFavorite(lot.name)}} title={favorites.includes(lot.name)?'Убрать из избранного':'Добавить в избранное'}><Heart size={16} fill={favorites.includes(lot.name)?'currentColor':'none'}/></button><button className="small-action" onClick={e=>{e.stopPropagation();chooseLot(lot);onGoBooking()}} title="Выбрать парковку"><CheckCircle2 size={16}/></button><button className="small-action" disabled={routeLoading} onClick={e=>{e.stopPropagation();selectLot(lot);showRoute(lot)}} title="Построить маршрут"><Navigation size={16}/></button></article>)}</div></section>
 </div>
}
function ParkingZone({title,subtitle,spots,selected,onSelect}:any){const free=spots.filter((s:Spot)=>s.status==='Свободно').length;const occupied=spots.filter((s:Spot)=>s.status==='Занято').length;const reserved=spots.filter((s:Spot)=>s.status==='Забронировано').length;return <section className="zone-panel"><div className="zone-panel-head"><div><b>{title}</b><small>{subtitle}</small></div><div className="zone-counts"><span className="zone-free-count">{free} свободно</span><span>{occupied} занято</span><span>{reserved} резерв</span></div></div><div className="spot-grid">{spots.map((spot:Spot)=><SpotTile key={spot.id} spot={spot} selected={selected===spot.id} onClick={()=>onSelect(spot.status==='Свободно'?spot.id:null)}/>)}</div>{!spots.length&&<p className="zone-empty">По этому поиску места не найдены. Очистите поиск, чтобы увидеть все места зоны.</p>}</section>}
function SpotTile({spot,selected,onClick}:any){const cls=spot.status==='Свободно'?'spot-free':spot.status==='Занято'?'spot-busy':'spot-reserved';return <button disabled={spot.status!=='Свободно'} className={`spot-tile ${cls} ${selected?'selected':''}`} onClick={onClick}><b>{spotName(spot)}</b><small>{spot.status}</small></button>}
function BookingPage({spots,selected,onSelect,date,setDate,start,setStart,end,setEnd,vehicles,vehicleId,setVehicleId,total,tariff,subscriptionDiscount,promo,setPromo,promoApplied,applyPromo,onCreate,onGoMap,lots,selectedLotId,parkingName,parkingAddress,onSelectParking}:any){
 const [bookingZone,setBookingZone]=useState('A');
 const free=spots.filter((s:Spot)=>s.status==='Свободно'&&s.zone===bookingZone);
 const s=spots.find((x:Spot)=>x.id===selected);
 return <div className="content"><div className="page-intro"><h2>Новое бронирование</h2><p>Выберите парковку, место и время</p></div><section className="form-card">
 <label className="field">Парковка<select value={selectedLotId} onChange={e=>{onSelectParking(Number(e.target.value));setBookingZone('A')}}>{lots.map((lot:any)=><option key={lot.id} value={lot.id}>{lot.name} — {lot.address}</option>)}</select></label>
 <div className="booking-selected-lot"><MapPin size={15}/><span><b>{parkingName}</b><small>{parkingAddress}</small></span><button type="button" onClick={onGoMap}>На карте</button></div>
 <label className="field">Зона парковки<select value={bookingZone} onChange={e=>{setBookingZone(e.target.value);onSelect(null)}}><option value="A">Зона A</option><option value="B">Зона B</option></select></label>
 <label className="field">Выберите место<select value={selected||''} onChange={e=>onSelect(Number(e.target.value)||null)}><option value="">Выберите свободное место</option>{free.map((x:Spot)=><option key={x.id} value={x.id}>{spotName(x)} · Свободно</option>)}</select></label>
 <button className="text-link" onClick={onGoMap}><MapPinned size={14}/> Посмотреть схему парковки</button>
 <label className="field">Автомобиль<select value={vehicleId} onChange={e=>setVehicleId(Number(e.target.value))}>{vehicles.map((v:Vehicle)=><option key={v.id} value={v.id}>{v.plate} · {v.make} {v.model}</option>)}</select></label>
 <div className="two-fields"><label className="field">Дата<input type="date" min={todayISO()} value={date} onChange={e=>setDate(e.target.value)}/></label><label className="field">Время начала<input type="time" value={start} onChange={e=>setStart(e.target.value)}/></label></div>
 <label className="field">Время окончания<input type="time" value={end} onChange={e=>setEnd(e.target.value)}/></label><div className="promo-row"><input placeholder="Промокод" value={promo} onChange={e=>setPromo(e.target.value.toUpperCase())}/><button onClick={applyPromo}>{promoApplied?'Применён':'Применить'}</button></div>
 <div className="estimate"><span>Предварительная стоимость</span><b>{s&&end>start?money(total):'—'}</b><small>{money(tariff)} / час {subscriptionDiscount>0?`· абонемент −${subscriptionDiscount}%`:''} {promoApplied?'· промокод −10%':''}</small></div><button className="primary-btn full" onClick={onCreate}>Подтвердить бронирование <ChevronRight size={16}/></button><p className="hint">Бронирование подтверждается после оплаты. Пересекающиеся интервалы одного места запрещены.</p>
 </section></div>;
}
function HistoryPage({bookings,query,setQuery,filter,setFilter,onExport,onPass,onCancel,onExit,onExtend,onPay,payments,onReceipt}:any){return <div className="content"><div className="page-intro"><h2>История парковки</h2><p>Все въезды, выезды и бронирования</p></div><div className="map-search"><Search size={16}/><input placeholder="Поиск по номеру автомобиля" value={query} onChange={e=>setQuery(e.target.value)}/></div><div className="filter-tabs">{['Все','Подтверждено','Ожидает оплаты','Активно','Завершено','Отменено'].map(f=><button className={filter===f?'active':''} key={f} onClick={()=>setFilter(f)}>{f}</button>)}</div><div className="history-list">{bookings.map((b:Booking)=><article className="history-card" key={b.id}><div className="history-icon"><CarFront size={18}/></div><div className="history-body"><b>{b.car} · {b.id}</b><span>{b.parkingName&&<>{b.parkingName} · </>}Место {b.spot} · {b.date}</span><small>{b.start}–{b.end} · {b.payment}</small><em className={`status-label ${b.status==='Подтверждено'?'green':b.status==='Активно'?'blue':b.status==='Отменено'?'red':b.status==='Завершено'?'grey':'orange'}`}>{b.status}</em><div className="history-actions">{['Подтверждено','Активно'].includes(b.status)&&!b.entrySimulated&&<button onClick={()=>onPass(b)}><QrCode size={13}/>Пропуск</button>}{b.entrySimulated&&b.status==='Активно'&&<><span className="entry-used-label"><CheckCircle2 size={13}/>Въезд выполнен · QR использован</span><button className="primary-btn" onClick={()=>onExit(b.id)}>Зарегистрировать выезд</button></>}{b.status==='Завершено'&&<span className="entry-used-label"><CheckCircle2 size={13}/>Поездка завершена{b.exitTime?` · ${new Date(b.exitTime).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`:''}</span>}{b.status==='Ожидает оплаты'&&<button onClick={()=>onPay(b)}><Wallet size={13}/>Оплатить</button>}{['Подтверждено','Активно'].includes(b.status)&&<button onClick={()=>onExtend(b)}><RefreshCw size={13}/>Продлить</button>}{!['Отменено','Завершено'].includes(b.status)&&<button className="danger-link" onClick={()=>onCancel(b.id)}><X size={13}/>Отменить</button>}</div></div><strong>{money(b.amount)}</strong></article>)}{!bookings.length&&<div className="empty-state">Ничего не найдено</div>}</div><section className="payment-history"><div className="section-head"><h3 className="section-title">История платежей</h3><span>{payments.length} операций</span></div>{payments.length?payments.map((p:PaymentRecord)=><article className="payment-history-row" key={p.id}><div className={`payment-history-icon ${p.status==='Успешно'?'paid':'not-paid'}`}>{p.status==='Успешно'?<CheckCircle2 size={16}/>:<X size={16}/>}</div><div className="payment-history-main"><b>{p.bookingId} · {p.method}</b><span>{new Date(p.createdAt).toLocaleString('ru-RU')} · {p.id}</span><small className={p.status==='Успешно'?'receipt-success':'receipt-muted'}>{p.status}</small></div><strong>{money(p.amount)}</strong>{p.status==='Успешно'&&<button className="small-action" onClick={()=>onReceipt(p)} title="Скачать чек"><Download size={15}/></button>}</article>):<p className="hint">Здесь будут отображаться результаты демонстрационных оплат.</p>}</section><button className="export-btn" onClick={onExport}><Download size={15}/>Экспортировать журнал</button></div>}
function ProfilePage({cloudSyncConfigured,profileName,email,phone,avatar,walletBalance,onAvatarUpload,onTopUp,paymentMethods,onBindCard,onBindSbp,onRemovePaymentMethod,onOpenFavorite,notificationsEnabled,onToggleNotifications,vehicles,onEdit,onAddVehicle,onDeleteVehicle,favorites,onFavorite,onToggleVehicleChip,subscriptions,onSubscription,onCancelSubscription,notify,onSupport,onLogout}:any){return <div className="content"><div className="page-intro"><h2>Профиль</h2><p>Личные данные и автомобили</p></div><section className="profile-summary"><div className="profile-initials">{avatar?<img src={avatar} alt="Аватар пользователя"/>:initials(profileName)}</div><div className="profile-summary-main"><b>{profileName}</b><span>{email}</span><small>Пользовательский аккаунт</small><label className="avatar-upload-btn"><input type="file" accept="image/*" onChange={e=>onAvatarUpload(e.target.files?.[0])}/>Загрузить аватарку</label></div></section><section className="profile-section wallet-section"><div className="wallet-heading"><div><small>МОЙ БАЛАНС</small><b>{money(walletBalance)}</b></div><Wallet size={26}/></div><p>Оплачивайте бронирования средствами внутреннего кошелька.</p><div className="wallet-topup-actions"><button className="primary-btn" onClick={onTopUp}><Plus size={15}/> Пополнить баланс</button></div><div className="payment-methods-list">{paymentMethods.map((method:PaymentMethod)=><div className="bound-method" key={method.id}><div className="bound-method-icon">{method.kind==='sbp'?<Smartphone size={16}/>:<CreditCard size={16}/>}</div><div><b>{method.label}</b><small>{method.details}</small></div><button onClick={()=>onRemovePaymentMethod(method.id)} title="Удалить способ"><X size={14}/></button></div>)}</div><div className="wallet-bind-actions"><button onClick={onBindSbp}><Smartphone size={14}/> Привязать СБП</button><button onClick={onBindCard}><CreditCard size={14}/> Привязать карту</button></div><small className="hint">Виртуальные способы оплаты для демонстрации. Реальные платежи не выполняются.</small></section><div className="profile-section"><div className="profile-section-head"><h3>Личные данные</h3><button onClick={onEdit}>Изменить</button></div><div className="profile-row"><span>Имя и фамилия</span><b>{profileName}</b></div><div className="profile-row"><span>Электронная почта</span><b>{email}</b></div><div className="profile-row"><span>Телефон</span><b>{phone||'Не указан'}</b></div></div><div className="profile-section"><div className="profile-section-head"><h3>Мои автомобили</h3><button onClick={onAddVehicle}><Plus size={14}/> Добавить</button></div>{vehicles.map((v:Vehicle)=><div className="vehicle-row vehicle-chip-row" key={v.id}>{v.photo?<img className="vehicle-thumb" src={v.photo} alt={v.make}/>:<CarFront/>}<div><b>{v.plate}</b><span>{v.make} {v.model} · {v.color}</span><small className={v.chipEnabled===false?'chip-disabled':'chip-active'}>Чип {v.tagId||vehicleChipId(v)} · {v.chipEnabled===false?'Выключен':'Активен'}</small></div><button onClick={()=>onToggleVehicleChip(v.id)} title={v.chipEnabled===false?'Включить чип':'Выключить чип'}>{v.chipEnabled===false?<ShieldCheck size={15}/>:<Zap size={15}/>}</button><button onClick={()=>onDeleteVehicle(v.id)} title="Удалить"><Trash2 size={15}/></button></div>)}</div><div className="profile-section"><h3>Избранные парковки</h3>{favorites.length?favorites.map((f:string)=><div className="vehicle-row favorite-profile-row" key={f} onClick={()=>onOpenFavorite(f)}><Heart fill="#f36b83" color="#f36b83"/><div><b>{f}</b><span>Открыть парковку на карте</span></div><button onClick={e=>{e.stopPropagation();onFavorite(f)}} title="Убрать из избранного"><X size={15}/></button></div>):<p className="hint">Добавляйте парковки в избранное на карте.</p>}</div><section className="profile-section subscriptions-section"><div className="subscriptions-heading"><div><h3>Абонементы</h3><p>Выберите срок и получайте скидку на каждое бронирование.</p></div><div className="subscriptions-balance"><small>Доступно на балансе</small><b>{money(walletBalance)}</b><button onClick={onTopUp}>Пополнить</button></div></div><div className="subscription-plans-grid">{subscriptions.map((s:any)=>{const expired=Boolean(s.expiresAt&&Date.parse(s.expiresAt)<=Date.now());const active=Boolean(s.active&&!expired);const anotherActive=subscriptions.some((item:any)=>item.id!==s.id&&item.active&&(!item.expiresAt||Date.parse(item.expiresAt)>Date.now()));const PlanIcon=s.id==='day'?Clock3:s.id==='week'?CalendarClock:BadgePercent;return <article className={`subscription-plan-card ${s.id==='week'?'recommended':''} ${active?'is-active':''}`} key={s.id}><div className="subscription-plan-top"><span className="subscription-plan-icon"><PlanIcon size={19}/></span><span className={`subscription-plan-badge ${s.id==='week'?'popular':''}`}>{s.badge}</span></div><h4>{s.name}</h4><p className="subscription-plan-description">{s.description}</p><div className="subscription-plan-price"><b>{money(s.price)}</b><span>/ {s.durationLabel}</span></div><div className="subscription-discount"><BadgePercent size={15}/> Скидка {s.discountPct}% на бронирования</div><ul>{s.features.map((feature:string)=><li key={feature}><CheckCircle2 size={14}/>{feature}</li>)}</ul>{active?<><div className="subscription-active-note"><CheckCircle2 size={15}/> Подключён до {s.expiresAt?new Date(s.expiresAt).toLocaleDateString('ru-RU'):'без срока'}</div><button className="subscription-plan-button" onClick={()=>onSubscription(s.id)}>Продлить ещё за {money(s.price)}</button><button className="subscription-plan-button cancel" onClick={()=>onCancelSubscription(s.id)}>Отменить абонемент</button></>:<><button className="subscription-plan-button" disabled={anotherActive} onClick={()=>onSubscription(s.id)}>{anotherActive?'Сначала завершите текущий':`Подключить за ${money(s.price)}`}</button>{expired&&<small className="subscription-expired-note">Срок предыдущего абонемента истёк</small>}</>}</article>})}</div><small className="subscription-footnote">Абонемент оплачивается с внутреннего демонстрационного баланса. Скидка автоматически учитывается в предварительной стоимости бронирования. Автопродления и реальные банковские списания нет.</small></section><section className="profile-section cloud-sync-status"><div className="profile-section-head"><h3><ShieldCheck size={15}/> Синхронизация аккаунта</h3><span className={cloudSyncConfigured?"cloud-ready":"cloud-local"}>{cloudSyncConfigured?"Облако подключено":"Только это устройство"}</span></div><p>{cloudSyncConfigured?"Данные аккаунта синхронизируются через Supabase между устройствами после входа в один аккаунт.":"Сейчас аккаунт хранится в браузере этого устройства. Чтобы входить с iPhone и другого компьютера с теми же данными, нужно настроить Supabase и файл .env.local. Регистрация на другом устройстве сама по себе не переносит локальные данные."}</p></section><section className="profile-section ios-install-card"><div className="profile-section-head"><h3><Smartphone size={15}/> Parking Manager на iPhone</h3><span>PWA</span></div><p>Откройте опубликованную HTTPS-версию в Safari → «Поделиться» → «На экран Домой» → «Добавить». Приложение появится отдельной иконкой и откроется в режиме приложения.</p><small>Для GPS необходим HTTPS. В веб-версии навигация и голосовые подсказки работают при активном экране; для надёжного GPS при блокировке iPhone потребуется отдельная нативная iOS-версия.</small></section><div className="profile-section"><h3>Поддержка и настройки</h3><div className="setting-line"><span>Уведомления</span><button className={`toggle-switch ${notificationsEnabled?'on':'off'}`} onClick={onToggleNotifications} aria-pressed={notificationsEnabled}><i/>{notificationsEnabled?'Включены':'Выключены'}</button></div><div className="setting-line"><span>Помощь и поддержка</span><button onClick={onSupport}>Открыть</button></div></div><button className="logout-btn" onClick={onLogout}><LogOut size={15}/>Выйти из аккаунта</button><small className="version">Parking Manager · Пользовательская версия</small></div>}
