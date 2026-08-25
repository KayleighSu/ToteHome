import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, SafeAreaView,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import QRCodeGenerator from 'qrcode';
import type { Session } from '@supabase/supabase-js';
import { completeMobileSignIn, isCloudConfigured, supabase } from './src/supabase';
import { acceptCloudInvite, createCloudHousehold, createCloudInvite, loadCloudInventory, loadHouseholdMembers, saveCloudProfile, saveCloudTote, type CloudMember } from './src/cloud';

type Household = { id: string; name: string; color: string; members: number; role?: string };
type Item = { id: string; name: string; quantity: string; notes: string; image?: string; imagePath?: string };
type Tote = { id: string; householdId: string; number: number; title: string; location: string; detail: string; color: string; image?: string; imagePath?: string; items: Item[]; updatedAt: string };
type Tab = 'home' | 'totes' | 'search' | 'settings';
type LabelSize = 'small' | 'medium' | 'large';

const C = { ink: '#18332F', muted: '#667874', cream: '#F7F5EE', teal: '#147D6F', pale: '#DDF1EB', coral: '#ED805F', line: '#E3E6DF' };
const STORAGE_KEY = 'totehome-v2';
const fallbackHouseholds: Household[] = [
  { id: 'home', name: 'My Household', color: '#147D6F', members: 1 },
];
const seed: Tote[] = [];
const locationChoices = ['Attic', 'Garage', 'Basement', 'Closet', 'Storage unit', 'Other'];

async function choosePhoto(): Promise<string | undefined> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [4, 3],
    quality: 0.65,
    base64: true,
  });
  if (result.canceled || !result.assets[0]) return undefined;
  const asset = result.assets[0];
  return asset.base64 ? `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}` : asset.uri;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [localPreview, setLocalPreview] = useState(false);
  const [tutorial, setTutorial] = useState(false);
  const [tab, setTab] = useState<Tab>('home');
  const [households, setHouseholds] = useState<Household[]>(fallbackHouseholds);
  const [householdId, setHouseholdId] = useState('home');
  const [totes, setTotes] = useState(seed);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<Tote | null>(null);
  const [housePicker, setHousePicker] = useState(false);
  const [addTote, setAddTote] = useState(false);
  const [scanner, setScanner] = useState(false);
  const [label, setLabel] = useState<Tote | null>(null);
  const [labelSize, setLabelSize] = useState<LabelSize>('medium');
  const [profile, setProfile] = useState<{ name: string; avatar?: string; avatarPath?: string }>({ name: '' });
  const identity = session?.user.id || (localPreview ? 'local-preview' : null);
  const house = households.find(h => h.id === householdId) || households[0] || fallbackHouseholds[0];
  const visibleTotes = totes.filter(t => t.householdId === householdId);

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => setSession(data.session)).finally(() => setAuthLoading(false));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const handle = ({ url }: { url: string }) => completeMobileSignIn(url).catch(error => Alert.alert('Could not finish verification', error.message));
    Linking.getInitialURL().then(url => { if (url) handle({ url }); });
    const subscription = Linking.addEventListener('url', handle);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!identity) return;
    AsyncStorage.getItem(`totehome-tutorial-${identity}`).then(done => { if (!done) setTutorial(true); });
  }, [identity]);

  useEffect(() => {
    if (!identity) return;
    AsyncStorage.getItem(`totehome-label-size-${identity}`).then(value => { if (value === 'small' || value === 'medium' || value === 'large') setLabelSize(value); });
    setProfile({ name: String(session?.user.user_metadata?.full_name || session?.user.email?.split('@')[0] || 'ToteHome user') });
  }, [identity, session?.user.user_metadata?.full_name]);

  useEffect(() => {
    if (!identity) { setTotes([]); setLoaded(false); return; }
    setLoaded(false);
    if (session) {
      loadCloudInventory().then(data => { setHouseholds(data.households as Household[]); setTotes(data.totes as Tote[]); if (data.households[0]) setHouseholdId(data.households[0].id); }).catch(error => Alert.alert('Could not sync', error.message)).finally(() => setLoaded(true));
    } else {
      setHouseholds(fallbackHouseholds);
      AsyncStorage.getItem(`${STORAGE_KEY}-${identity}`).then(v => setTotes(v ? JSON.parse(v) : [])).catch(() => setTotes([])).finally(() => setLoaded(true));
    }
  }, [identity, session]);

  useEffect(() => {
    if (!session || Platform.OS !== 'web') return;
    const token = new URL(window.location.href).searchParams.get('invite');
    if (!token) return;
    acceptCloudInvite(token).then(async () => {
      window.history.replaceState({}, '', window.location.pathname);
      const data = await loadCloudInventory();
      setHouseholds(data.households as Household[]); setTotes(data.totes as Tote[]);
      if (data.households[0]) setHouseholdId(data.households[0].id);
      Alert.alert('Household joined', 'The shared household is now available.');
    }).catch((error: any) => Alert.alert('Could not join household', error.message));
  }, [session?.user.id]);
  useEffect(() => { if (loaded && identity && !session) AsyncStorage.setItem(`${STORAGE_KEY}-${identity}`, JSON.stringify(totes)).catch(() => {}); }, [totes, loaded, identity, session]);

  async function saveTote(tote: Tote) {
    setTotes(all => all.map(t => t.id === tote.id ? tote : t)); setSelected(tote);
    if (session) {
      try { const saved = await saveCloudTote(session.user.id, tote) as Tote; setTotes(all => all.map(t => t.id === tote.id ? saved : t)); setSelected(saved); }
      catch (error: any) { Alert.alert('Could not sync tote', error.message); }
    }
  }
  function scan(value: string) {
    const found = totes.find(t => `totehome://tote/${t.id}` === value);
    setScanner(false);
    if (!found) return Alert.alert('Tote not found', 'This label is not in one of your shared households.');
    setHouseholdId(found.householdId); setSelected(found);
  }
  if (authLoading) return <LoadingScreen />;
  if (!session && !localPreview) return <AuthScreen onPreview={() => setLocalPreview(true)} />;
  if (!loaded) return <LoadingScreen />;
  if (selected) return <ToteDetail tote={selected} household={households.find(h => h.id === selected.householdId) || house} onBack={() => setSelected(null)} onSave={saveTote} onLabel={() => setLabel(selected)} label={label} closeLabel={() => setLabel(null)} labelSize={labelSize} />;

  async function finishTutorial(addFirst = false) {
    const identity = session?.user.id || 'local-preview';
    await AsyncStorage.setItem(`totehome-tutorial-${identity}`, 'done');
    setTutorial(false);
    if (addFirst) setAddTote(true);
  }

  return <SafeAreaView style={s.safe}><StatusBar style="dark" /><View style={s.app}>
    <Header household={house} onHouse={() => setHousePicker(true)} onScan={() => setScanner(true)} />
    <View style={s.content}>
      {tab === 'home' && <Home household={house} totes={visibleTotes} open={setSelected} all={() => setTab('totes')} add={() => setAddTote(true)} />}
      {tab === 'totes' && <Totes totes={visibleTotes} open={setSelected} add={() => setAddTote(true)} />}
      {tab === 'search' && <Search totes={totes} households={households} open={t => { setHouseholdId(t.householdId); setSelected(t); }} />}
      {tab === 'settings' && <Settings household={house} totes={visibleTotes} email={session?.user.email || 'Local preview'} profile={profile} labelSize={labelSize} setLabelSize={async size => { setLabelSize(size); if (identity) await AsyncStorage.setItem(`totehome-label-size-${identity}`, size); }} openTote={setSelected} invite={session && house.role === 'owner' ? async email => { const token = await createCloudInvite(house.id, email); const link = `${window.location.origin}/ToteHome/?invite=${token}`; const message = `You’re invited to join ${house.name} in ToteHome. Open this link, create or sign into your account, then in Safari tap Share → Add to Home Screen: ${link}`; if (navigator.share) await navigator.share({ title: `Join ${house.name} on ToteHome`, text: message, url: link }); else { await navigator.clipboard?.writeText(message); Alert.alert('Invitation copied', 'Send the copied message to the person you invited.'); } } : undefined} loadMembers={session ? () => loadHouseholdMembers(house.id) : undefined} saveProfile={session ? async (name, image) => { const saved = await saveCloudProfile(session.user.id, name, session.user.email || '', image, profile.avatarPath); setProfile(saved); } : undefined} signOut={async () => { if (supabase && session) await supabase.auth.signOut(); setLocalPreview(false); }} deleteAccount={session ? async () => { if (!supabase) return; const { error } = await supabase.rpc('delete_current_user'); if (error) return Alert.alert('Could not delete account', error.message); await AsyncStorage.removeItem(`${STORAGE_KEY}-${session.user.id}`); await supabase.auth.signOut(); setTotes([]); } : undefined} />}
    </View><Nav active={tab} change={setTab} />
  </View>
    <HouseholdSheet visible={housePicker} households={households} selected={householdId} close={() => setHousePicker(false)} choose={id => { setHouseholdId(id); setHousePicker(false); }} createHousehold={session ? async name => { await createCloudHousehold(name); const data = await loadCloudInventory(); setHouseholds(data.households as Household[]); setTotes(data.totes as Tote[]); } : undefined} inviteMember={session ? async (email, target) => { const token = await createCloudInvite(target, email); const link = Platform.OS === 'web' ? `${window.location.origin}/ToteHome/?invite=${token}` : `totehome://invite/${token}`; if (Platform.OS === 'web' && navigator.clipboard) await navigator.clipboard.writeText(link); Alert.alert('Invitation ready', Platform.OS === 'web' ? 'The invitation link was copied. Send it to the invited email address.' : link); } : undefined} />
    <AddTote visible={addTote} householdId={householdId} totes={totes} close={() => setAddTote(false)} add={async t => { setAddTote(false); if (session) { try { const saved = await saveCloudTote(session.user.id, t) as Tote; setTotes(all => [saved, ...all]); setSelected(saved); } catch (error: any) { Alert.alert('Could not create tote', error.message); } } else { setTotes(all => [t, ...all]); setSelected(t); } }} />
    <Scanner visible={scanner} close={() => setScanner(false)} scan={scan} />
    <Tutorial visible={tutorial} skip={() => finishTutorial(false)} addFirst={() => finishTutorial(true)} />
  </SafeAreaView>;
}

function Header({ household, onHouse, onScan }: { household: Household; onHouse: () => void; onScan: () => void }) {
  return <View style={s.header}><Pressable style={s.brand} onPress={onHouse}><View style={s.logo}><Ionicons name="cube" size={19} color="#fff" /></View><View><Text style={s.brandName}>ToteHome</Text><View style={s.houseRow}><Text style={s.houseName}>{household.name}</Text><Ionicons name="chevron-down" size={13} color={C.muted} /></View></View></Pressable><Pressable style={s.iconButton} onPress={onScan}><Ionicons name="scan" size={22} color={C.teal} /></Pressable></View>;
}

function LoadingScreen() {
  return <SafeAreaView style={s.safe}><View style={s.loading}><View style={s.logoLarge}><Ionicons name="cube" size={30} color="#fff" /></View><Text style={s.loadingName}>ToteHome</Text></View></SafeAreaView>;
}

function AuthScreen({ onPreview }: { onPreview: () => void }) {
  const [mode, setMode] = useState<'signup' | 'signin'>('signup');
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!supabase) return;
    if (!email.trim() || password.length < 6) return Alert.alert('Check your details', 'Enter an email and a password with at least 6 characters.');
    setBusy(true);
    try {
      if (mode === 'signup') {
        const redirectTo = Platform.OS === 'web'
          ? new URL(window.location.pathname.startsWith('/ToteHome') ? '/ToteHome/' : '/', window.location.origin).toString()
          : 'totehome://auth/callback';
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { full_name: name.trim() }, emailRedirectTo: redirectTo } });
        if (error) throw error;
        if (!data.session) setConfirmationSent(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
    } catch (error: any) { Alert.alert(mode === 'signup' ? 'Could not create account' : 'Could not sign in', error.message || 'Please try again.'); }
    finally { setBusy(false); }
  }

  if (confirmationSent) return <SafeAreaView style={s.authSafe}><StatusBar style="light" /><ScrollView contentContainerStyle={s.authScroll}><View style={s.authBrand}><View style={s.logoLarge}><Ionicons name="cube" size={30} color="#fff" /></View><Text style={s.authBrandName}>ToteHome</Text></View><View style={s.authCard}><View style={s.emailSuccessIcon}><Ionicons name="mail-outline" size={34} color={C.teal} /></View><Text style={[s.authTitle, { textAlign: 'center' }]}>Check your email</Text><Text style={s.confirmEmail}>We sent a verification link to{`\n`}<Text style={{ fontWeight: '900', color: C.ink }}>{email.trim()}</Text></Text><View style={s.confirmSteps}><View style={s.confirmStep}><Text style={s.stepNumber}>1</Text><Text style={s.stepText}>Open the email from Supabase and click the verification link.</Text></View><View style={s.confirmStep}><Text style={s.stepNumber}>2</Text><Text style={s.stepText}>Return to ToteHome and sign in with the password you created.</Text></View></View><Pressable style={s.fullPrimary} onPress={() => { setConfirmationSent(false); setMode('signin'); }}><Ionicons name="log-in-outline" size={20} color="#fff" /><Text style={s.primaryText}>I verified my email — Sign in</Text></Pressable><Text style={s.spamHint}>Don’t see it? Check your spam or junk folder.</Text></View></ScrollView></SafeAreaView>;

  return <SafeAreaView style={s.authSafe}><StatusBar style="light" /><ScrollView contentContainerStyle={s.authScroll} keyboardShouldPersistTaps="handled"><View style={s.authBrand}><View style={s.logoLarge}><Ionicons name="cube" size={30} color="#fff" /></View><Text style={s.authBrandName}>ToteHome</Text><Text style={s.authTagline}>Know exactly where everything lives.</Text></View><View style={s.authCard}><Text style={s.authTitle}>{mode === 'signup' ? 'Create your account' : 'Welcome back'}</Text><Text style={s.authSubtitle}>{mode === 'signup' ? 'Start with an empty household and organize it your way.' : 'Sign in after verifying your email.'}</Text>{mode === 'signup' && <Field label="YOUR NAME" value={name} change={setName} placeholder="Your name" />}<Field label="EMAIL" value={email} change={setEmail} placeholder="you@example.com" /><Field label="PASSWORD" value={password} change={setPassword} placeholder="At least 6 characters" /><Pressable style={[s.fullPrimary, busy && { opacity: .6 }]} disabled={busy || !isCloudConfigured} onPress={submit}><Text style={s.primaryText}>{busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}</Text></Pressable>{!isCloudConfigured && <View style={s.cloudNotice}><Ionicons name="cloud-offline-outline" size={19} color={C.coral} /><Text style={s.cloudNoticeText}>Cloud credentials still need to be added before real accounts can connect.</Text></View>}<Pressable style={s.authSwitch} onPress={() => setMode(mode === 'signup' ? 'signin' : 'signup')}><Text style={s.authSwitchText}>{mode === 'signup' ? 'Already verified? Sign in' : 'New to ToteHome? Create an account'}</Text></Pressable><Pressable style={s.previewButton} onPress={onPreview}><Text style={s.previewButtonText}>Preview without an account</Text></Pressable></View></ScrollView></SafeAreaView>;
}

function Tutorial({ visible, skip, addFirst }: { visible: boolean; skip: () => void; addFirst: () => void }) {
  const [step, setStep] = useState(0);
  useEffect(() => { if (visible) setStep(0); }, [visible]);
  const pages = [
    { icon: 'home-outline' as const, title: 'Welcome to your household', body: 'Each household keeps its own totes, locations, and members. You can create more or join your parents’ household later.' },
    { icon: 'search-outline' as const, title: 'Find anything quickly', body: 'Totes shows everything by location. Search checks every household you belong to, and the scan button opens a tote from its QR label.' },
    { icon: 'cube-outline' as const, title: 'Ready for your first tote?', body: 'Give it a useful name, choose where it lives, and optionally add a photo. ToteHome assigns the number automatically.' },
  ];
  const page = pages[step];
  return <Modal visible={visible} animationType="fade" transparent><View style={s.tutorialBackdrop}><View style={s.tutorialCard}><Pressable style={s.skipTutorial} onPress={skip}><Text style={s.skipText}>Skip tutorial</Text></Pressable><View style={s.tutorialIcon}><Ionicons name={page.icon} size={38} color={C.teal} /></View><Text style={s.tutorialTitle}>{page.title}</Text><Text style={s.tutorialBody}>{page.body}</Text><View style={s.dots}>{pages.map((_, i) => <View key={i} style={[s.dot, i === step && s.dotOn]} />)}</View>{step < pages.length - 1 ? <Pressable style={s.fullPrimary} onPress={() => setStep(step + 1)}><Text style={s.primaryText}>Next</Text></Pressable> : <Pressable style={s.fullPrimary} onPress={addFirst}><Ionicons name="add" size={20} color="#fff" /><Text style={s.primaryText}>Add my first tote</Text></Pressable>}</View></View></Modal>;
}

function Home({ household, totes, open, all, add }: { household: Household; totes: Tote[]; open: (t: Tote) => void; all: () => void; add: () => void }) {
  const items = totes.reduce((n, t) => n + t.items.length, 0), locations = new Set(totes.map(t => t.location)).size;
  return <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}><View style={s.hero}><Text style={s.eyebrow}>EVERYTHING IN ITS PLACE</Text><Text style={s.heroTitle}>Find it without{`\n`}opening a single tote.</Text><Text style={s.heroText}>{totes.length} totes and {items} items organized at {household.name.toLowerCase()}.</Text><Pressable style={s.primary} onPress={add}><Ionicons name="add" size={21} color="#fff" /><Text style={s.primaryText}>Add a tote</Text></Pressable></View>
    <View style={s.stats}><Stat icon="cube-outline" value={totes.length} label="Totes" /><Stat icon="list-outline" value={items} label="Items" /><Stat icon="location-outline" value={locations} label="Locations" /></View>
    <View style={s.sectionHead}><Text style={s.sectionTitle}>Recently updated</Text><Pressable onPress={all}><Text style={s.link}>See all</Text></Pressable></View>{totes.slice(0, 3).map(t => <ToteCard key={t.id} tote={t} open={() => open(t)} />)}{!totes.length && <Empty add={add} />}</ScrollView>;
}
function Stat({ icon, value, label }: { icon: keyof typeof Ionicons.glyphMap; value: number; label: string }) { return <View style={s.stat}><Ionicons name={icon} size={19} color={C.teal} /><Text style={s.statValue}>{value}</Text><Text style={s.statLabel}>{label}</Text></View>; }
function ToteCard({ tote, open }: { tote: Tote; open: () => void }) {
  return <Pressable style={({ pressed }) => [s.toteCard, pressed && { opacity: .7 }]} onPress={open}>
    <View style={[s.toteNumber, { backgroundColor: tote.color }]}>
      {tote.image ? <><Image source={{ uri: tote.image }} style={s.cardImage} /><View style={s.photoNumber}><Text style={s.photoNumberText}>{String(tote.number).padStart(2, '0')}</Text></View></> : <><Text style={s.toteSmall}>TOTE</Text><Text style={s.toteNum}>{String(tote.number).padStart(2, '0')}</Text></>}
    </View>
    <View style={{ flex: 1 }}><Text style={s.toteTitle}>{tote.title}</Text><View style={s.metaRow}><Ionicons name="location-outline" size={14} color={C.muted} /><Text style={s.meta}>{tote.location}{tote.detail ? ` · ${tote.detail}` : ''}</Text></View><Text style={s.preview} numberOfLines={1}>{tote.items.map(i => i.name).join(', ') || 'No items added yet'}</Text></View><Ionicons name="chevron-forward" size={20} color="#A9B3B0" />
  </Pressable>;
}

function Totes({ totes, open, add }: { totes: Tote[]; open: (t: Tote) => void; add: () => void }) {
  const [filter, setFilter] = useState('All'); const filters = ['All', ...Array.from(new Set(totes.map(t => t.location)))]; const shown = filter === 'All' ? totes : totes.filter(t => t.location === filter);
  return <ScrollView contentContainerStyle={s.scroll}><View style={s.titleRow}><View><Text style={s.pageTitle}>Your totes</Text><Text style={s.subtitle}>{totes.length} organized containers</Text></View><Pressable style={s.roundAdd} onPress={add}><Ionicons name="add" size={25} color="#fff" /></Pressable></View><ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filters}>{filters.map(f => <Pressable key={f} style={[s.filter, filter === f && s.filterOn]} onPress={() => setFilter(f)}><Text style={[s.filterText, filter === f && { color: '#fff' }]}>{f}</Text></Pressable>)}</ScrollView>{shown.map(t => <ToteCard key={t.id} tote={t} open={() => open(t)} />)}{!shown.length && <Empty add={add} />}</ScrollView>;
}

function Search({ totes, households, open }: { totes: Tote[]; households: Household[]; open: (t: Tote) => void }) {
  const [query, setQuery] = useState(''); const results = useMemo(() => { const q = query.trim().toLowerCase(); return q ? totes.flatMap(tote => tote.items.filter(i => `${i.name} ${i.notes}`.toLowerCase().includes(q)).map(item => ({ tote, item }))) : []; }, [query, totes]);
  return <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled"><Text style={s.pageTitle}>Find anything</Text><Text style={s.subtitle}>Search every shared household at once.</Text><View style={s.search}><Ionicons name="search" size={21} color={C.muted} /><TextInput value={query} onChangeText={setQuery} placeholder="Try “Christmas lights”" placeholderTextColor="#98A39F" style={s.searchInput} />{query ? <Pressable onPress={() => setQuery('')}><Ionicons name="close-circle" size={20} color="#A8B1AE" /></Pressable> : null}</View>
    {!query && <Info icon="sparkles-outline" title="A place for everything" body="Search item names and notes. We’ll show the household, location, and exact tote." />}{query ? <Text style={s.resultCount}>{results.length} {results.length === 1 ? 'match' : 'matches'}</Text> : null}{results.map(({ tote, item }) => <Pressable key={item.id} style={s.result} onPress={() => open(tote)}><View style={s.resultIcon}><Ionicons name="cube-outline" size={22} color={C.teal} /></View><View style={{ flex: 1 }}><Text style={s.resultName}>{item.name}</Text><Text style={s.resultMeta}>Tote {String(tote.number).padStart(2, '0')} · {tote.location}</Text><Text style={s.resultHouse}>{households.find(h => h.id === tote.householdId)?.name}</Text></View><Ionicons name="arrow-forward" size={19} color={C.teal} /></Pressable>)}{query && !results.length ? <Info title="Nothing found yet" body="Try a shorter phrase, or add the item to a tote." /> : null}</ScrollView>;
}

function ToteDetail({ tote, household, onBack, onSave, onLabel, label, closeLabel, labelSize }: { tote: Tote; household: Household; onBack: () => void; onSave: (t: Tote) => void; onLabel: () => void; label: Tote | null; closeLabel: () => void; labelSize: LabelSize }) {
  const [adding, setAdding] = useState(false);
  async function addTotePhoto() { const image = await choosePhoto(); if (image) onSave({ ...tote, image, updatedAt: 'Today' }); }
  return <SafeAreaView style={s.safe}><StatusBar style="dark" /><View style={s.detailHeader}><Pressable style={s.iconButton} onPress={onBack}><Ionicons name="arrow-back" size={23} color={C.ink} /></Pressable><Text style={s.headerTitle}>Tote details</Text><Pressable style={s.iconButton} onPress={onLabel}><Ionicons name="qr-code-outline" size={22} color={C.teal} /></Pressable></View><ScrollView contentContainerStyle={s.detailScroll}>
    {tote.image ? <Pressable onPress={addTotePhoto}><Image source={{ uri: tote.image }} style={s.detailPhoto} /><View style={s.changePhoto}><Ionicons name="camera" size={16} color="#fff" /><Text style={s.changePhotoText}>Change photo</Text></View></Pressable> : null}
    <View style={[s.detailHero, { backgroundColor: tote.color }]}><Text style={s.detailLabel}>TOTE</Text><Text style={s.detailNumber}>{String(tote.number).padStart(2, '0')}</Text><View style={s.qrMini}><QRCode value={`totehome://tote/${tote.id}`} size={62} color={C.ink} /></View></View>
    {!tote.image && <Pressable style={s.photoPrompt} onPress={addTotePhoto}><Ionicons name="camera-outline" size={19} color={C.teal} /><Text style={s.photoPromptText}>Add an optional tote photo</Text></Pressable>}
    <Text style={s.detailTitle}>{tote.title}</Text><View style={s.detailLocation}><Ionicons name="location" size={19} color={C.teal} /><Text style={s.locationText}>{tote.location}{tote.detail ? ` · ${tote.detail}` : ''}</Text></View><Pressable style={s.labelButton} onPress={onLabel}><Ionicons name="print-outline" size={20} color={C.teal} /><Text style={s.labelText}>Create & print labels</Text></Pressable><View style={s.sectionHead}><Text style={s.sectionTitle}>Inside this tote</Text><Text style={s.count}>{tote.items.length}</Text></View>
    {tote.items.map(i => <View key={i.id} style={s.item}>{i.image ? <Image source={{ uri: i.image }} style={s.itemImage} /> : <View style={s.check}><Ionicons name="checkmark" size={14} color={C.teal} /></View>}<View style={{ flex: 1 }}><Text style={s.itemName}>{i.name}</Text>{i.notes ? <Text style={s.itemNotes}>{i.notes}</Text> : null}</View><Text style={s.quantity}>{i.quantity}</Text></View>)}
    {!tote.items.length && <Text style={s.emptyItems}>Nothing listed yet. Add the first item so it can be found later.</Text>}<Pressable style={s.addItem} onPress={() => setAdding(true)}><Ionicons name="add-circle-outline" size={21} color={C.teal} /><Text style={s.addItemText}>Add an item</Text></Pressable></ScrollView><AddItem visible={adding} close={() => setAdding(false)} add={item => { onSave({ ...tote, items: [...tote.items, item], updatedAt: 'Today' }); setAdding(false); }} /><LabelSheet tote={label} household={household} close={closeLabel} size={labelSize} /></SafeAreaView>;
}

function Settings({ household, totes, email, profile, labelSize, setLabelSize, openTote, invite, loadMembers, saveProfile, signOut, deleteAccount }: { household: Household; totes: Tote[]; email: string; profile: { name: string; avatar?: string; avatarPath?: string }; labelSize: LabelSize; setLabelSize: (size: LabelSize) => void; openTote: (t: Tote) => void; invite?: (email: string) => Promise<void>; loadMembers?: () => Promise<CloudMember[]>; saveProfile?: (name: string, image?: string) => Promise<void>; signOut: () => void; deleteAccount?: () => void }) {
  const [panel, setPanel] = useState<'locations' | 'members' | 'labels' | 'profile' | null>(null);
  function confirmDelete() {
    const message = 'This permanently deletes your account and any household you own, including its totes and items. This cannot be undone.';
    if (Platform.OS === 'web') { if (window.confirm(`${message}\n\nDelete account permanently?`)) deleteAccount?.(); return; }
    Alert.alert('Delete account permanently?', message, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete my account', style: 'destructive', onPress: deleteAccount }]);
  }
  return <><ScrollView contentContainerStyle={s.scroll}><Text style={s.pageTitle}>Household</Text><Text style={s.subtitle}>Keep your spaces and people organized.</Text><Pressable style={s.profile} onPress={() => setPanel('profile')}>{profile.avatar ? <Image source={{ uri: profile.avatar }} style={s.avatar} /> : <View style={[s.avatar, { backgroundColor: household.color }]}><Text style={s.avatarText}>{(profile.name || household.name)[0]}</Text></View>}<View style={{ flex: 1 }}><Text style={s.profileTitle}>{profile.name || household.name}</Text><Text style={s.profileMeta}>{email}</Text></View><Ionicons name="chevron-forward" size={20} color="#A9B3B0" /></Pressable><Text style={s.settingsLabel}>ORGANIZATION</Text><Setting icon="location-outline" title="Locations" sub={`${new Set(totes.map(t => t.location)).size} locations · ${totes.length} totes`} press={() => setPanel('locations')} /><Setting icon="people-outline" title="Members" sub={`${household.members} ${household.members === 1 ? 'member' : 'members'} · Invite and search`} press={() => setPanel('members')} /><Setting icon="pricetags-outline" title="Label preferences" sub={`${labelSize[0].toUpperCase()}${labelSize.slice(1)} labels · Letter paper`} press={() => setPanel('labels')} /><Text style={s.settingsLabel}>ACCOUNT</Text><View style={s.syncCard}><Ionicons name="cloud-done" size={21} color={C.teal} /><View><Text style={s.settingTitle}>Saved to your account</Text><Text style={s.settingSub}>Changes sync automatically across your devices.</Text></View></View><Setting icon="person-circle-outline" title="Edit profile" sub="Name and profile picture" press={() => setPanel('profile')} /><Pressable style={s.signOutButton} onPress={signOut}><Ionicons name="log-out-outline" size={19} color={C.coral} /><Text style={s.signOutText}>Sign out</Text></Pressable>{deleteAccount && <Pressable style={s.deleteAccountButton} onPress={confirmDelete}><Ionicons name="trash-outline" size={18} color="#A73D32" /><Text style={s.deleteAccountText}>Delete account permanently</Text></Pressable>}</ScrollView><LocationsSheet visible={panel === 'locations'} close={() => setPanel(null)} totes={totes} open={t => { setPanel(null); openTote(t); }} /><MembersSheet visible={panel === 'members'} close={() => setPanel(null)} invite={invite} load={loadMembers} /><LabelPreferences visible={panel === 'labels'} close={() => setPanel(null)} value={labelSize} change={setLabelSize} /><ProfileSheet visible={panel === 'profile'} close={() => setPanel(null)} profile={profile} email={email} save={saveProfile} /></>;
}
function Setting({ icon, title, sub, press }: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string; press: () => void }) { return <Pressable style={s.setting} onPress={press}><View style={s.settingIcon}><Ionicons name={icon} size={21} color={C.teal} /></View><View style={{ flex: 1 }}><Text style={s.settingTitle}>{title}</Text><Text style={s.settingSub}>{sub}</Text></View><Ionicons name="chevron-forward" size={18} color="#A9B3B0" /></Pressable>; }

function LocationsSheet({ visible, close, totes, open }: { visible: boolean; close: () => void; totes: Tote[]; open: (t: Tote) => void }) { const grouped = Array.from(new Set(totes.map(t => t.location))).sort(); return <Sheet visible={visible} close={close} title="Locations">{!grouped.length ? <Info icon="location-outline" title="No locations yet" body="Locations appear here when you add your first tote." /> : grouped.map(location => <View key={location}><View style={s.locationHead}><Text style={s.sectionTitle}>{location}</Text><Text style={s.count}>{totes.filter(t => t.location === location).length}</Text></View>{totes.filter(t => t.location === location).map(t => <ToteCard key={t.id} tote={t} open={() => open(t)} />)}</View>)}</Sheet>; }

function MembersSheet({ visible, close, invite, load }: { visible: boolean; close: () => void; invite?: (email: string) => Promise<void>; load?: () => Promise<CloudMember[]> }) { const [members, setMembers] = useState<CloudMember[]>([]), [query, setQuery] = useState(''), [email, setEmail] = useState(''), [busy, setBusy] = useState(false); useEffect(() => { if (visible && load) load().then(setMembers).catch(e => Alert.alert('Could not load members', e.message)); }, [visible]); const shown = members.filter(m => `${m.name} ${m.email}`.toLowerCase().includes(query.toLowerCase())); async function send() { if (!invite || !email.trim()) return; setBusy(true); try { await invite(email.trim()); setEmail(''); } catch (e: any) { Alert.alert('Could not create invitation', e.message); } finally { setBusy(false); } } return <Sheet visible={visible} close={close} title="Household members"><Text style={s.sheetIntro}>Search people who already have access, or invite someone by email.</Text><View style={s.search}><Ionicons name="search" size={20} color={C.muted} /><TextInput style={s.searchInput} value={query} onChangeText={setQuery} placeholder="Search name or email" placeholderTextColor="#98A39F" /></View><View style={{ height: 14 }} />{shown.map(m => <View key={m.userId} style={s.memberRow}>{m.avatar ? <Image source={{ uri: m.avatar }} style={s.memberAvatar} /> : <View style={s.memberAvatarFallback}><Text style={s.avatarText}>{m.name[0]}</Text></View>}<View style={{ flex: 1 }}><Text style={s.settingTitle}>{m.name}</Text><Text style={s.settingSub}>{m.email || 'Email hidden'} · {m.role}</Text></View></View>)}<View style={s.divider} />{invite ? <><Field label="INVITE BY EMAIL" value={email} change={setEmail} placeholder="person@example.com" /><Pressable style={[s.fullPrimary, busy && { opacity: .6 }]} onPress={send} disabled={busy}><Ionicons name="share-outline" size={19} color="#fff" /><Text style={s.primaryText}>{busy ? 'Creating link…' : 'Share invitation'}</Text></Pressable><Text style={s.printHint}>The shared message includes the app link and “Share → Add to Home Screen” instructions.</Text></> : <Text style={s.printHint}>Only the household owner can invite new members.</Text>}</Sheet>; }

function LabelPreferences({ visible, close, value, change }: { visible: boolean; close: () => void; value: LabelSize; change: (v: LabelSize) => void }) { return <Sheet visible={visible} close={close} title="Label preferences"><Text style={s.sheetIntro}>Choose the default size used for both the top and side tote labels.</Text>{(['small','medium','large'] as LabelSize[]).map(size => <Pressable key={size} style={[s.sizeOption, value === size && s.sizeOptionOn]} onPress={() => change(size)}><View><Text style={s.settingTitle}>{size[0].toUpperCase() + size.slice(1)}</Text><Text style={s.settingSub}>{size === 'small' ? 'Four compact labels per page' : size === 'medium' ? 'Two balanced labels per page' : 'One extra-readable label per page'}</Text></View>{value === size && <Ionicons name="checkmark-circle" size={23} color={C.teal} />}</Pressable>)}<View style={s.printNote}><Ionicons name="print-outline" size={22} color={C.teal} /><Text style={s.printNoteText}>Print at 100% on US Letter plain sticker paper, or use regular printer paper and secure each label with clear packing tape.</Text></View></Sheet>; }

function ProfileSheet({ visible, close, profile, email, save }: { visible: boolean; close: () => void; profile: { name: string; avatar?: string }; email: string; save?: (name: string, image?: string) => Promise<void> }) { const [name, setName] = useState(profile.name), [image, setImage] = useState<string | undefined>(profile.avatar), [busy, setBusy] = useState(false); useEffect(() => { if (visible) { setName(profile.name); setImage(profile.avatar); } }, [visible]); async function submit() { if (!save || !name.trim()) return; setBusy(true); try { await save(name, image); close(); } catch (e: any) { Alert.alert('Could not save profile', e.message); } finally { setBusy(false); } } return <Sheet visible={visible} close={close} title="Your profile"><PhotoPicker image={image} pick={async () => { const p = await choosePhoto(); if (p) setImage(p); }} remove={() => setImage(undefined)} label="PROFILE PICTURE (OPTIONAL)" /><Field label="DISPLAY NAME" value={name} change={setName} placeholder="Your name" /><Text style={s.printHint}>{email}</Text>{save ? <Pressable style={[s.fullPrimary, busy && { opacity: .6 }]} disabled={busy} onPress={submit}><Text style={s.primaryText}>{busy ? 'Saving…' : 'Save profile'}</Text></Pressable> : <Text style={s.printHint}>Sign in to save a profile across devices.</Text>}</Sheet>; }

function Nav({ active, change }: { active: Tab; change: (t: Tab) => void }) { const tabs: [Tab, string, keyof typeof Ionicons.glyphMap][] = [['home', 'Home', 'home'], ['totes', 'Totes', 'cube'], ['search', 'Search', 'search'], ['settings', 'Household', 'settings']]; return <View style={s.nav}>{tabs.map(([id, label, icon]) => <Pressable key={id} style={s.navItem} onPress={() => change(id)}><Ionicons name={active === id ? icon : `${icon}-outline` as keyof typeof Ionicons.glyphMap} size={23} color={active === id ? C.teal : '#87938F'} /><Text style={[s.navText, active === id && { color: C.teal }]}>{label}</Text></Pressable>)}</View>; }

function HouseholdSheet({ visible, households, selected, close, choose, createHousehold, inviteMember }: { visible: boolean; households: Household[]; selected: string; close: () => void; choose: (id: string) => void; createHousehold?: (name: string) => Promise<void>; inviteMember?: (email: string, householdId: string) => Promise<void> }) {
  const [mode, setMode] = useState<'list' | 'create' | 'invite'>('list');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (visible) { setMode('list'); setValue(''); } }, [visible]);
  const selectedHouse = households.find(h => h.id === selected);
  async function submit() {
    if (!value.trim()) return;
    setBusy(true);
    try {
      if (mode === 'create' && createHousehold) await createHousehold(value.trim());
      if (mode === 'invite' && inviteMember) await inviteMember(value.trim(), selected);
      setValue(''); setMode('list');
    } catch (error: any) { Alert.alert('Could not complete that', error.message); }
    finally { setBusy(false); }
  }
  return <Sheet visible={visible} close={close} title={mode === 'list' ? 'Your households' : mode === 'create' ? 'Create a household' : 'Invite a member'}>
    {mode === 'list' ? <><Text style={s.sheetIntro}>Each account sees only the households it owns or has joined.</Text>{households.map(h => <Pressable key={h.id} style={[s.houseOption, selected === h.id && s.houseOptionOn]} onPress={() => choose(h.id)}><View style={[s.houseDot, { backgroundColor: h.color }]} /><View style={{ flex: 1 }}><Text style={s.houseOptionName}>{h.name}</Text><Text style={s.houseOptionMeta}>{h.members} {h.members === 1 ? 'member' : 'members'} · {h.role || 'member'}</Text></View>{selected === h.id && <Ionicons name="checkmark-circle" size={23} color={C.teal} />}</Pressable>)}{createHousehold && <Pressable style={s.outline} onPress={() => setMode('create')}><Ionicons name="add" size={20} color={C.teal} /><Text style={s.outlineText}>Create another household</Text></Pressable>}{inviteMember && selectedHouse?.role === 'owner' && <Pressable style={s.outline} onPress={() => setMode('invite')}><Ionicons name="person-add-outline" size={19} color={C.teal} /><Text style={s.outlineText}>Invite someone to {selectedHouse.name}</Text></Pressable>}</> : <><Text style={s.sheetIntro}>{mode === 'create' ? 'This household starts empty and private.' : 'Enter the exact email address they will use for their ToteHome account.'}</Text><Field label={mode === 'create' ? 'HOUSEHOLD NAME' : 'EMAIL ADDRESS'} value={value} change={setValue} placeholder={mode === 'create' ? "e.g. Parents' House" : 'parent@example.com'} /><Pressable style={[s.fullPrimary, busy && { opacity: .6 }]} disabled={busy} onPress={submit}><Text style={s.primaryText}>{busy ? 'Please wait…' : mode === 'create' ? 'Create household' : 'Create invitation link'}</Text></Pressable><Pressable style={s.authSwitch} onPress={() => setMode('list')}><Text style={s.authSwitchText}>Back to households</Text></Pressable></>}
  </Sheet>;
}

function AddTote({ visible, householdId, totes, close, add }: { visible: boolean; householdId: string; totes: Tote[]; close: () => void; add: (t: Tote) => void }) {
  const [title, setTitle] = useState(''), [location, setLocation] = useState('Garage'), [detail, setDetail] = useState(''), [image, setImage] = useState<string>();
  function submit() { if (!title.trim()) return Alert.alert('Give this tote a name'); const number = Math.max(0, ...totes.filter(t => t.householdId === householdId).map(t => t.number)) + 1; add({ id: `tote-${Date.now()}`, householdId, number, title: title.trim(), location, detail: detail.trim(), image, color: ['#79A9A0', '#B99BC6', '#ED805F', '#EAB65B'][number % 4], items: [], updatedAt: 'Today' }); setTitle(''); setDetail(''); setImage(undefined); }
  async function pick() { const chosen = await choosePhoto(); if (chosen) setImage(chosen); }
  return <Sheet visible={visible} close={close} title="Add a new tote"><Field label="WHAT'S THIS TOTE FOR?" value={title} change={setTitle} placeholder="e.g. Winter clothes" /><Text style={s.fieldLabel}>LOCATION</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 18 }}>{locationChoices.map(v => <Pressable key={v} style={[s.choice, location === v && s.choiceOn]} onPress={() => setLocation(v)}><Text style={[s.choiceText, location === v && { color: '#fff' }]}>{v}</Text></Pressable>)}</ScrollView><Field label="MORE DETAIL (OPTIONAL)" value={detail} change={setDetail} placeholder="e.g. Shelf B, top row" /><PhotoPicker image={image} pick={pick} remove={() => setImage(undefined)} label="TOTE PHOTO (OPTIONAL)" /><Primary label="Create tote" press={submit} /></Sheet>;
}
function AddItem({ visible, close, add }: { visible: boolean; close: () => void; add: (i: Item) => void }) {
  const [name, setName] = useState(''), [quantity, setQuantity] = useState('1'), [notes, setNotes] = useState(''), [image, setImage] = useState<string>();
  function submit() { if (!name.trim()) return Alert.alert('What is the item called?'); add({ id: `item-${Date.now()}`, name: name.trim(), quantity: quantity.trim() || '1', notes: notes.trim(), image }); setName(''); setQuantity('1'); setNotes(''); setImage(undefined); }
  async function pick() { const chosen = await choosePhoto(); if (chosen) setImage(chosen); }
  return <Sheet visible={visible} close={close} title="Add an item"><Field label="ITEM NAME" value={name} change={setName} placeholder="e.g. Extension cords" /><Field label="QUANTITY" value={quantity} change={setQuantity} placeholder="1" /><Field label="NOTES (OPTIONAL)" value={notes} change={setNotes} placeholder="Color, size, condition..." /><PhotoPicker image={image} pick={pick} remove={() => setImage(undefined)} label="ITEM PHOTO (OPTIONAL)" /><Primary label="Add item" press={submit} /></Sheet>;
}
function PhotoPicker({ image, pick, remove, label }: { image?: string; pick: () => void; remove: () => void; label: string }) {
  return <View style={s.field}><Text style={s.fieldLabel}>{label}</Text>{image ? <View style={s.pickedPhotoWrap}><Image source={{ uri: image }} style={s.pickedPhoto} /><View style={s.photoActions}><Pressable style={s.smallPhotoButton} onPress={pick}><Ionicons name="camera-outline" size={17} color={C.teal} /><Text style={s.smallPhotoText}>Change</Text></Pressable><Pressable style={s.smallPhotoButton} onPress={remove}><Ionicons name="trash-outline" size={17} color={C.coral} /><Text style={[s.smallPhotoText, { color: C.coral }]}>Remove</Text></Pressable></View></View> : <Pressable style={s.photoPicker} onPress={pick}><Ionicons name="image-outline" size={22} color={C.teal} /><View><Text style={s.photoPickerTitle}>Add a photo</Text><Text style={s.photoPickerSub}>Choose one from your device</Text></View></Pressable>}</View>;
}
function Field({ label, value, change, placeholder }: { label: string; value: string; change: (v: string) => void; placeholder: string }) { return <View style={s.field}><Text style={s.fieldLabel}>{label}</Text><TextInput style={s.input} value={value} onChangeText={change} placeholder={placeholder} placeholderTextColor="#9BA5A2" /></View>; }
function Primary({ label, press }: { label: string; press: () => void }) { return <Pressable style={s.fullPrimary} onPress={press}><Text style={s.primaryText}>{label}</Text></Pressable>; }

function Scanner({ visible, close, scan }: { visible: boolean; close: () => void; scan: (v: string) => void }) { const [permission, request] = useCameraPermissions(); const [locked, setLocked] = useState(false); useEffect(() => { if (visible) setLocked(false); }, [visible]); return <Modal visible={visible} animationType="slide"><View style={s.scanner}><SafeAreaView style={{ flex: 1 }}><View style={s.scannerHeader}><Pressable style={s.scannerClose} onPress={close}><Ionicons name="close" size={26} color="#fff" /></Pressable><Text style={s.scannerTitle}>Scan a tote label</Text><View style={{ width: 44 }} /></View>{!permission?.granted ? <View style={s.permission}><Ionicons name="camera-outline" size={48} color="#fff" /><Text style={s.permissionTitle}>Camera access needed</Text><Text style={s.permissionText}>ToteHome uses the camera only while you scan a QR label.</Text><Pressable style={s.permissionButton} onPress={request}><Text style={s.primaryText}>Allow camera</Text></Pressable></View> : <View style={{ flex: 1 }}><CameraView style={StyleSheet.absoluteFill} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => { if (!locked) { setLocked(true); scan(data); } }} /><View style={s.scanOverlay}><View style={s.scanFrame} /><Text style={s.scanHint}>Line up the QR code inside the frame</Text></View></View>}</SafeAreaView></View></Modal>; }

function LabelSheet({ tote, household, close, size }: { tote: Tote | null; household: Household; close: () => void; size: LabelSize }) {
  if (!tote) return null;
  const active = tote;
  const house = household;
  const payload = `totehome://tote/${active.id}`;
  const dimensions = size === 'small' ? { width: 3.65, height: 2.25, qr: 1.35, columns: '1in 1fr 1.45in', number: 42, title: 14, gap: .12 } : size === 'large' ? { width: 7.55, height: 6.8, qr: 3.2, columns: '1.7in 1fr 3.35in', number: 76, title: 26, gap: .3 } : { width: 7.55, height: 3.25, qr: 2.15, columns: '1.55in 1fr 2.3in', number: 62, title: 21, gap: .28 };

  async function create() {
    try {
      const qrData = await QRCodeGenerator.toDataURL(payload, {
        width: 700,
        margin: 2,
        color: { dark: C.ink, light: '#FFFFFF' },
      });
      const label = (placement: string) => `
        <section class="label">
          <div class="copy">${placement}</div>
          <div class="number-block">
            <div class="tote-word">TOTE</div>
            <div class="number">${String(active.number).padStart(2, '0')}</div>
          </div>
          <div class="details">
            <div class="title">${active.title}</div>
            <div class="location">${house.name}</div>
            <div class="location">${active.location}${active.detail ? ` · ${active.detail}` : ''}</div>
          </div>
          <img class="qr" src="${qrData}" />
        </section>`;
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Tote ${active.number} Labels</title><style>
        @page { size: letter portrait; margin: .45in; }
        * { box-sizing: border-box; }
        body { margin: 0; color: #18332f; background: white; font-family: Arial, Helvetica, sans-serif; }
        .instructions { margin: 0 0 .22in; color: #667874; font-size: 10pt; text-align: center; }
        .sheet { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: .25in; }
        .label { position: relative; width: ${dimensions.width}in; height: ${dimensions.height}in; border: 3px solid #18332f; border-radius: .18in; padding: .22in; display: grid; grid-template-columns: ${dimensions.columns}; align-items: center; gap: ${dimensions.gap}in; overflow: hidden; page-break-inside: avoid; }
        .label:before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: .14in; background: #147d6f; }
        .copy { position: absolute; top: .12in; right: .16in; color: #71817d; font-size: 8pt; font-weight: bold; letter-spacing: 1.3px; }
        .number-block { text-align: center; border-right: 2px solid #dce4e1; padding-right: .25in; }
        .tote-word { color: #147d6f; font-size: 14pt; font-weight: 900; letter-spacing: 4px; }
        .number { font-size: ${dimensions.number}pt; line-height: .95; font-weight: 900; }
        .title { font-size: ${dimensions.title}pt; line-height: 1.05; font-weight: 900; margin-bottom: .12in; }
        .location { font-size: 13pt; line-height: 1.35; font-weight: 700; color: #52645f; }
        .qr { display: block; width: ${dimensions.qr}in; height: ${dimensions.qr}in; justify-self: end; image-rendering: pixelated; }
        @media print { .instructions { display: none; } .sheet { padding-top: .05in; } }
      </style></head><body><p class="instructions">Print at 100% scale, then cut around each border.</p><main class="sheet">${label('TOP LABEL')}${label('SIDE LABEL')}</main><script>window.onload=()=>setTimeout(()=>window.print(),250);</script></body></html>`;

      if (Platform.OS === 'web') {
        const printWindow = window.open('', '_blank');
        if (!printWindow) return Alert.alert('Pop-up blocked', 'Allow pop-ups for this page, then try again.');
        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();
        return;
      }
      const file = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf' });
      else await Print.printAsync({ html });
    } catch {
      Alert.alert('Could not create labels', 'Please try again.');
    }
  }

  return <Sheet visible close={close} title="Your tote labels"><Text style={s.sheetIntro}>Two matching labels—one for the lid and one for the side.</Text><View style={s.labelPreview}><View><Text style={s.labelTag}>TOTE</Text><Text style={s.labelNumber}>{String(active.number).padStart(2, '0')}</Text><Text style={s.labelLocation}>{active.location}</Text><Text style={s.labelHouse}>{house.name}</Text></View><QRCode value={payload} size={116} color={C.ink} /></View><View style={s.copies}><Ionicons name="copy-outline" size={19} color={C.teal} /><Text style={s.copiesText}>{size[0].toUpperCase() + size.slice(1)} size · top and side copies</Text></View><Text style={s.printHint}>Print at 100% on letter-size sticker paper, or print on regular paper and attach with clear packing tape.</Text><Pressable style={s.fullPrimary} onPress={create}><Ionicons name="share-outline" size={20} color="#fff" /><Text style={s.primaryText}>Create printable PDF</Text></Pressable></Sheet>;
}

function Sheet({ visible, close, title, children }: { visible: boolean; close: () => void; title: string; children: React.ReactNode }) { return <Modal visible={visible} transparent animationType="slide" onRequestClose={close}><KeyboardAvoidingView style={s.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><Pressable style={{ flex: 1 }} onPress={close} /><View style={s.sheet}><View style={s.handle} /><View style={s.sheetHead}><Text style={s.sheetTitle}>{title}</Text><Pressable style={s.close} onPress={close}><Ionicons name="close" size={21} color={C.ink} /></Pressable></View><ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView></View></KeyboardAvoidingView></Modal>; }
function Info({ icon, title, body }: { icon?: keyof typeof Ionicons.glyphMap; title: string; body: string }) { return <View style={s.info}>{icon && <View style={s.infoIcon}><Ionicons name={icon} size={25} color={C.teal} /></View>}<Text style={s.infoTitle}>{title}</Text><Text style={s.infoBody}>{body}</Text></View>; }
function Empty({ add }: { add: () => void }) { return <View style={s.info}><Ionicons name="cube-outline" size={37} color={C.teal} /><Text style={s.infoTitle}>Your first tote starts here</Text><Text style={s.infoBody}>Add a tote, choose its location, then list what is inside.</Text><Pressable onPress={add}><Text style={s.link}>Add a tote</Text></Pressable></View>; }

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cream }, app: { flex: 1 }, content: { flex: 1 }, scroll: { padding: 20, paddingBottom: 35 }, header: { height: 70, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#EBECE7' }, brand: { flexDirection: 'row', alignItems: 'center', gap: 10 }, logo: { width: 38, height: 38, borderRadius: 12, backgroundColor: C.teal, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-4deg' }] }, brandName: { fontSize: 17, fontWeight: '800', color: C.ink }, houseRow: { flexDirection: 'row', alignItems: 'center' }, houseName: { fontSize: 11, color: C.muted, fontWeight: '600' }, iconButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  hero: { backgroundColor: C.ink, borderRadius: 24, padding: 24 }, eyebrow: { color: '#8DD0C2', fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginBottom: 12 }, heroTitle: { color: '#fff', fontSize: 31, lineHeight: 36, fontWeight: '800', letterSpacing: -.8 }, heroText: { color: '#C8D6D2', fontSize: 14, lineHeight: 20, marginTop: 12 }, primary: { backgroundColor: C.coral, alignSelf: 'flex-start', marginTop: 20, height: 45, paddingHorizontal: 18, borderRadius: 14, flexDirection: 'row', gap: 7, alignItems: 'center' }, primaryText: { color: '#fff', fontSize: 15, fontWeight: '800' }, stats: { flexDirection: 'row', gap: 9, marginVertical: 18 }, stat: { flex: 1, backgroundColor: '#fff', borderRadius: 17, padding: 13, borderWidth: 1, borderColor: C.line }, statValue: { fontSize: 22, fontWeight: '800', color: C.ink, marginTop: 6 }, statLabel: { fontSize: 11, fontWeight: '600', color: C.muted }, sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 7, marginBottom: 11 }, sectionTitle: { color: C.ink, fontSize: 18, fontWeight: '800' }, link: { color: C.teal, fontSize: 14, fontWeight: '800' },
  toteCard: { backgroundColor: '#fff', borderRadius: 17, padding: 12, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: C.line }, toteNumber: { width: 58, height: 62, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, toteSmall: { color: C.ink, fontSize: 8, fontWeight: '900', letterSpacing: 1.2 }, toteNum: { color: C.ink, fontSize: 23, fontWeight: '900' }, toteTitle: { color: C.ink, fontSize: 15, fontWeight: '800', marginBottom: 4 }, metaRow: { flexDirection: 'row', alignItems: 'center', gap: 3 }, meta: { color: C.muted, fontSize: 12, fontWeight: '600' }, preview: { color: '#8A9692', fontSize: 11, marginTop: 5 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, pageTitle: { fontSize: 29, fontWeight: '900', color: C.ink, letterSpacing: -.7 }, subtitle: { color: C.muted, fontSize: 14, marginTop: 5, marginBottom: 20 }, roundAdd: { width: 45, height: 45, borderRadius: 15, backgroundColor: C.teal, alignItems: 'center', justifyContent: 'center' }, filters: { marginHorizontal: -20, paddingHorizontal: 20, marginBottom: 15, flexGrow: 0 }, filter: { height: 36, paddingHorizontal: 15, marginRight: 8, borderRadius: 18, justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: C.line }, filterOn: { backgroundColor: C.ink, borderColor: C.ink }, filterText: { color: C.muted, fontSize: 13, fontWeight: '700' },
  search: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1.5, borderColor: '#BFCAC6', height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, gap: 10 }, searchInput: { flex: 1, color: C.ink, fontSize: 16 }, info: { alignItems: 'center', paddingVertical: 52, paddingHorizontal: 30, gap: 7 }, infoIcon: { width: 55, height: 55, borderRadius: 18, backgroundColor: C.pale, alignItems: 'center', justifyContent: 'center', marginBottom: 8 }, infoTitle: { fontSize: 18, fontWeight: '800', color: C.ink, textAlign: 'center' }, infoBody: { color: C.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' }, resultCount: { color: C.muted, fontSize: 12, fontWeight: '700', marginVertical: 17 }, result: { backgroundColor: '#fff', borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: C.line, marginBottom: 9 }, resultIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: C.pale }, resultName: { color: C.ink, fontSize: 15, fontWeight: '800' }, resultMeta: { color: C.muted, fontSize: 12, marginTop: 3 }, resultHouse: { color: C.teal, fontSize: 10, fontWeight: '700', marginTop: 3 },
  nav: { height: 73, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: C.line, flexDirection: 'row' }, navItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 }, navText: { color: '#87938F', fontSize: 10, fontWeight: '700' }, detailHeader: { height: 65, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: C.line }, headerTitle: { color: C.ink, fontSize: 16, fontWeight: '800' }, detailScroll: { padding: 20, paddingBottom: 45 }, detailHero: { height: 155, borderRadius: 24, padding: 22, justifyContent: 'center' }, detailLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 2, color: C.ink }, detailNumber: { fontSize: 58, lineHeight: 64, fontWeight: '900', color: C.ink }, qrMini: { position: 'absolute', right: 20, backgroundColor: '#fff', padding: 9, borderRadius: 11 }, detailTitle: { marginTop: 20, color: C.ink, fontSize: 27, fontWeight: '900' }, detailLocation: { flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 7 }, locationText: { color: C.muted, fontSize: 14, fontWeight: '700' }, labelButton: { height: 48, marginVertical: 21, borderRadius: 14, backgroundColor: C.pale, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' }, labelText: { color: C.teal, fontSize: 14, fontWeight: '800' }, count: { backgroundColor: C.pale, color: C.teal, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 12, fontSize: 11, fontWeight: '800' }, item: { backgroundColor: '#fff', padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1, borderColor: C.line, marginBottom: 8 }, check: { width: 27, height: 27, borderRadius: 14, backgroundColor: C.pale, alignItems: 'center', justifyContent: 'center' }, itemName: { fontSize: 14, fontWeight: '800', color: C.ink }, itemNotes: { fontSize: 11, color: C.muted, marginTop: 3 }, quantity: { fontSize: 12, fontWeight: '700', color: C.muted }, emptyItems: { color: C.muted, lineHeight: 20, paddingVertical: 18 }, addItem: { height: 47, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#AFC9C2', marginTop: 4 }, addItemText: { color: C.teal, fontWeight: '800' },
  profile: { backgroundColor: '#fff', padding: 15, borderRadius: 17, borderWidth: 1, borderColor: C.line, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 25 }, avatar: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, avatarText: { color: '#fff', fontSize: 20, fontWeight: '900' }, profileTitle: { color: C.ink, fontSize: 16, fontWeight: '800' }, profileMeta: { color: C.muted, fontSize: 12, marginTop: 4 }, settingsLabel: { color: '#82908B', fontSize: 10, fontWeight: '900', letterSpacing: 1.4, marginBottom: 8, marginTop: 5 }, setting: { backgroundColor: '#fff', padding: 13, borderWidth: 1, borderColor: C.line, flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: -1 }, settingIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: C.pale, alignItems: 'center', justifyContent: 'center' }, settingTitle: { color: C.ink, fontSize: 14, fontWeight: '800' }, settingSub: { color: C.muted, fontSize: 11, marginTop: 3 }, note: { marginTop: 24, padding: 14, backgroundColor: '#FCEAE4', borderRadius: 14, flexDirection: 'row', gap: 10 }, noteText: { flex: 1, color: '#81584C', fontSize: 12, lineHeight: 18 },
  backdrop: { flex: 1, backgroundColor: 'rgba(18,35,32,.38)', justifyContent: 'flex-end' }, sheet: { backgroundColor: C.cream, borderTopLeftRadius: 27, borderTopRightRadius: 27, padding: 20, paddingTop: 10, maxHeight: '86%' }, handle: { width: 42, height: 5, borderRadius: 3, backgroundColor: '#C8CFCC', alignSelf: 'center', marginBottom: 13 }, sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 13 }, sheetTitle: { fontSize: 23, fontWeight: '900', color: C.ink }, close: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line }, sheetIntro: { color: C.muted, fontSize: 13, lineHeight: 19, marginBottom: 17 }, houseOption: { padding: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 15, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 9 }, houseOptionOn: { borderColor: C.teal, backgroundColor: '#F6FBF9' }, houseDot: { width: 39, height: 39, borderRadius: 13 }, houseOptionName: { color: C.ink, fontWeight: '800', fontSize: 15 }, houseOptionMeta: { color: C.muted, fontSize: 11, marginTop: 3 }, outline: { height: 47, borderRadius: 14, borderWidth: 1.5, borderColor: '#AFC9C2', flexDirection: 'row', gap: 7, justifyContent: 'center', alignItems: 'center', marginTop: 7 }, outlineText: { color: C.teal, fontWeight: '800' },
  field: { marginBottom: 18 }, fieldLabel: { color: C.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1.1, marginBottom: 7 }, input: { height: 50, backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 14, borderWidth: 1, borderColor: '#D7DCD8', color: C.ink, fontSize: 16 }, choice: { height: 38, borderRadius: 19, backgroundColor: '#fff', paddingHorizontal: 15, justifyContent: 'center', marginRight: 8, borderWidth: 1, borderColor: C.line }, choiceOn: { backgroundColor: C.ink, borderColor: C.ink }, choiceText: { color: C.muted, fontWeight: '700', fontSize: 13 }, fullPrimary: { height: 51, borderRadius: 15, backgroundColor: C.teal, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginTop: 5, marginBottom: 10 },
  scanner: { flex: 1, backgroundColor: '#102521' }, scannerHeader: { height: 68, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 3 }, scannerClose: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,.15)', alignItems: 'center', justifyContent: 'center' }, scannerTitle: { color: '#fff', fontSize: 17, fontWeight: '800' }, permission: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 35 }, permissionTitle: { color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 16 }, permissionText: { color: '#B9CBC7', textAlign: 'center', lineHeight: 20, marginTop: 8 }, permissionButton: { backgroundColor: C.coral, paddingHorizontal: 20, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 20 }, scanOverlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,.15)' }, scanFrame: { width: 250, height: 250, borderRadius: 26, borderWidth: 3, borderColor: '#fff' }, scanHint: { color: '#fff', backgroundColor: 'rgba(0,0,0,.52)', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, marginTop: 22, fontWeight: '700' },
  labelPreview: { backgroundColor: '#fff', borderRadius: 20, borderWidth: 2, borderColor: C.ink, padding: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, labelTag: { color: C.teal, fontSize: 10, fontWeight: '900', letterSpacing: 2 }, labelNumber: { color: C.ink, fontSize: 52, lineHeight: 57, fontWeight: '900' }, labelLocation: { color: C.ink, fontSize: 15, fontWeight: '800' }, labelHouse: { color: C.muted, fontSize: 11, marginTop: 3 }, copies: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginVertical: 15 }, copiesText: { color: C.muted, fontSize: 12, fontWeight: '600' },
  cardImage: { width: '100%', height: '100%', borderRadius: 13 }, photoNumber: { position: 'absolute', left: 4, bottom: 4, minWidth: 25, height: 21, paddingHorizontal: 5, borderRadius: 7, backgroundColor: 'rgba(24,51,47,.9)', alignItems: 'center', justifyContent: 'center' }, photoNumberText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  detailPhoto: { width: '100%', height: 205, borderRadius: 24, marginBottom: 12 }, changePhoto: { position: 'absolute', right: 12, bottom: 24, height: 34, paddingHorizontal: 11, borderRadius: 11, backgroundColor: 'rgba(24,51,47,.82)', flexDirection: 'row', gap: 6, alignItems: 'center' }, changePhotoText: { color: '#fff', fontSize: 11, fontWeight: '800' }, photoPrompt: { height: 43, borderRadius: 13, borderWidth: 1, borderColor: '#B9CEC8', backgroundColor: '#F0F7F5', flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', marginTop: 10 }, photoPromptText: { color: C.teal, fontSize: 12, fontWeight: '800' }, itemImage: { width: 48, height: 48, borderRadius: 11, backgroundColor: C.pale },
  photoPicker: { minHeight: 68, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#AFC9C2', backgroundColor: '#F8FCFA', paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 11 }, photoPickerTitle: { color: C.teal, fontSize: 13, fontWeight: '800' }, photoPickerSub: { color: C.muted, fontSize: 11, marginTop: 2 }, pickedPhotoWrap: { flexDirection: 'row', alignItems: 'center', gap: 12 }, pickedPhoto: { width: 94, height: 70, borderRadius: 13, backgroundColor: C.pale }, photoActions: { flex: 1, gap: 7 }, smallPhotoButton: { height: 31, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: '#fff', paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }, smallPhotoText: { color: C.teal, fontSize: 11, fontWeight: '800' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' }, logoLarge: { width: 62, height: 62, borderRadius: 20, backgroundColor: C.teal, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-4deg' }] }, loadingName: { color: C.ink, fontSize: 24, fontWeight: '900', marginTop: 14 },
  authSafe: { flex: 1, backgroundColor: C.ink }, authScroll: { flexGrow: 1, justifyContent: 'center', padding: 22, paddingVertical: 40 }, authBrand: { alignItems: 'center', marginBottom: 25 }, authBrandName: { color: '#fff', fontSize: 27, fontWeight: '900', marginTop: 13 }, authTagline: { color: '#B9CBC7', fontSize: 13, marginTop: 5 }, authCard: { width: '100%', maxWidth: 460, alignSelf: 'center', backgroundColor: C.cream, borderRadius: 25, padding: 22 }, authTitle: { color: C.ink, fontSize: 25, fontWeight: '900' }, authSubtitle: { color: C.muted, fontSize: 13, lineHeight: 19, marginTop: 6, marginBottom: 21 }, cloudNotice: { borderRadius: 12, backgroundColor: '#FCEAE4', padding: 11, flexDirection: 'row', gap: 8, alignItems: 'center' }, cloudNoticeText: { flex: 1, color: '#81584C', fontSize: 11, lineHeight: 16 }, authSwitch: { alignItems: 'center', paddingVertical: 13 }, authSwitchText: { color: C.teal, fontSize: 12, fontWeight: '800' }, previewButton: { height: 42, alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderTopColor: C.line }, previewButtonText: { color: C.muted, fontSize: 12, fontWeight: '700' },
  emailSuccessIcon: { width: 68, height: 68, borderRadius: 22, backgroundColor: C.pale, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 17 }, confirmEmail: { color: C.muted, fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 10 }, confirmSteps: { marginVertical: 23, gap: 12 }, confirmStep: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11 }, stepNumber: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.teal, color: '#fff', textAlign: 'center', lineHeight: 28, fontSize: 12, fontWeight: '900' }, stepText: { flex: 1, color: C.ink, fontSize: 12, lineHeight: 17, fontWeight: '700' }, spamHint: { color: C.muted, fontSize: 11, textAlign: 'center', marginTop: 6, marginBottom: 4 },
  tutorialBackdrop: { flex: 1, backgroundColor: 'rgba(18,35,32,.65)', alignItems: 'center', justifyContent: 'center', padding: 22 }, tutorialCard: { width: '100%', maxWidth: 440, borderRadius: 25, backgroundColor: C.cream, padding: 24, paddingTop: 58 }, skipTutorial: { position: 'absolute', right: 18, top: 17, padding: 7 }, skipText: { color: C.muted, fontSize: 12, fontWeight: '800', textDecorationLine: 'underline' }, tutorialIcon: { width: 76, height: 76, borderRadius: 24, backgroundColor: C.pale, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }, tutorialTitle: { color: C.ink, fontSize: 24, fontWeight: '900', textAlign: 'center', marginTop: 21 }, tutorialBody: { color: C.muted, fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 10, minHeight: 84 }, dots: { flexDirection: 'row', justifyContent: 'center', gap: 7, marginVertical: 18 }, dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#C6CECB' }, dotOn: { width: 22, backgroundColor: C.teal }, signOutButton: { height: 46, marginTop: 20, borderRadius: 14, borderWidth: 1, borderColor: '#F0C7BA', backgroundColor: '#FFF7F4', flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' }, signOutText: { color: C.coral, fontSize: 13, fontWeight: '800' },
  deleteAccountButton: { height: 44, marginTop: 10, borderRadius: 14, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' }, deleteAccountText: { color: '#A73D32', fontSize: 12, fontWeight: '800', textDecorationLine: 'underline' },
  syncCard: { backgroundColor: '#F0F7F5', padding: 14, borderWidth: 1, borderColor: '#CBE1DB', flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 9 },
  locationHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, marginBottom: 9 },
  memberRow: { backgroundColor: '#fff', padding: 12, borderWidth: 1, borderColor: C.line, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 8 },
  memberAvatar: { width: 42, height: 42, borderRadius: 13 }, memberAvatarFallback: { width: 42, height: 42, borderRadius: 13, backgroundColor: C.teal, alignItems: 'center', justifyContent: 'center' },
  divider: { height: 1, backgroundColor: C.line, marginVertical: 18 },
  sizeOption: { backgroundColor: '#fff', padding: 15, borderRadius: 15, borderWidth: 1, borderColor: C.line, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sizeOptionOn: { borderColor: C.teal, backgroundColor: '#F2FAF7' },
  printNote: { backgroundColor: C.pale, padding: 15, borderRadius: 15, flexDirection: 'row', gap: 11, marginTop: 10, marginBottom: 8 }, printNoteText: { flex: 1, color: C.ink, fontSize: 12, lineHeight: 18 }, printHint: { color: C.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginBottom: 14 },
});
