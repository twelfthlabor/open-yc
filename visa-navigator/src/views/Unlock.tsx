import { KeyRound, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Brand, ThemeToggle } from '@/components/app/Shell';
import { BlurFade } from '@/components/ui/blur-fade';
import { BorderBeam } from '@/components/ui/border-beam';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MIN_PASSPHRASE, newPassphraseError, WrongPassphraseError } from '@/crypto/vault';
import { useVault } from '@/state/VaultContext';

export function Unlock() {
  const vault = useVault();
  const isNew = vault.status === 'new';
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (isNew) {
      const problem = newPassphraseError(pass, confirm);
      if (problem) return setError(problem);
    }
    setBusy(true);
    try {
      if (isNew) await vault.create(pass);
      else await vault.unlock(pass);
    } catch (err) {
      setError(err instanceof WrongPassphraseError ? err.message : 'Could not open the vault.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col px-4">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between py-4">
        <Brand />
        <ThemeToggle />
      </div>
      <div className="grid flex-1 place-items-center pb-16">
        <BlurFade className="w-full max-w-md">
          <form onSubmit={submit} className="glass relative overflow-hidden rounded-3xl p-7">
            <BorderBeam size={120} duration={9} colorFrom="var(--primary)" colorTo="var(--success)" />
            <div className="mb-5 grid size-12 place-items-center rounded-2xl bg-primary/12 text-primary">
              {isNew ? <ShieldCheck /> : <KeyRound />}
            </div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight">{isNew ? 'Create your private vault' : 'Welcome back'}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {isNew
                ? 'Passports, documents and answers are encrypted on this device with a passphrase only you know.'
                : 'Enter your passphrase to unlock your applications.'}
            </p>
            <div className="mt-6 grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="pass">Passphrase</Label>
                <Input id="pass" type="password" autoFocus className="h-11 rounded-xl" autoComplete={isNew ? 'new-password' : 'current-password'} value={pass} onChange={(e) => setPass(e.target.value)} />
                {isNew && <p className="text-xs text-muted-foreground">At least {MIN_PASSPHRASE} characters.</p>}
              </div>
              {isNew && (
                <div className="grid gap-2">
                  <Label htmlFor="confirm">Confirm passphrase</Label>
                  <Input id="confirm" type="password" className="h-11 rounded-xl" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                </div>
              )}
              {isNew && <p className="rounded-xl bg-warning/15 px-3 py-2 text-xs text-warning-foreground dark:text-warning">There is no recovery. If you forget the passphrase, the data cannot be decrypted.</p>}
              {error && (
                <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" size="lg" className="h-11 rounded-xl text-base" disabled={busy || !pass}>
                {busy ? 'Working…' : isNew ? 'Create vault' : 'Unlock'}
              </Button>
              {!isNew &&
                (confirmWipe ? (
                  <div className="grid gap-2 rounded-xl bg-destructive/10 p-3 text-sm">
                    <span>This permanently deletes every application and document on this device.</span>
                    <div className="flex gap-2">
                      <Button type="button" variant="destructive" size="sm" onClick={() => vault.wipe()}>
                        Delete everything
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => setConfirmWipe(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmWipe(true)}>
                    Forgot passphrase? Start over
                  </Button>
                ))}
            </div>
          </form>
        </BlurFade>
      </div>
    </main>
  );
}
