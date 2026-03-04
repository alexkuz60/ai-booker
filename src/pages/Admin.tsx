import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { useLanguage } from '@/hooks/useLanguage';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Shield, Loader2, UserPlus, Trash2, Users, Crown, Star, User, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

type AppRole = 'admin' | 'moderator' | 'user';

interface UserWithRoles {
  user_id: string;
  username: string | null;
  display_name: string | null;
  roles: AppRole[];
}

const roleIcons: Record<AppRole, React.ElementType> = {
  admin: Shield,
  moderator: Star,
  user: User,
};

const roleColors: Record<AppRole, string> = {
  admin: 'bg-destructive/20 text-destructive border-destructive/50',
  moderator: 'bg-primary/20 text-primary border-primary/50',
  user: 'bg-muted text-muted-foreground border-border',
};

export default function Admin() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loaded: rolesLoaded } = useUserRole();
  const { isRu } = useLanguage();
  const navigate = useNavigate();

  const [users, setUsers] = useState<UserWithRoles[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState<AppRole>('user');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!authLoading && rolesLoaded) {
      if (!user) { navigate('/auth'); return; }
      if (!isAdmin) { toast.error(isRu ? 'Доступ запрещён' : 'Access denied'); navigate('/'); return; }
      fetchUsersWithRoles();
    }
  }, [user, authLoading, isAdmin, rolesLoaded, navigate]);

  const fetchUsersWithRoles = async () => {
    try {
      const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('id, username, display_name');
      if (pErr) throw pErr;

      const { data: roles, error: rErr } = await supabase
        .from('user_roles')
        .select('*');
      if (rErr) throw rErr;

      const map = new Map<string, UserWithRoles>();
      (profiles || []).forEach((p) => {
        map.set(p.id, { user_id: p.id, username: p.username, display_name: p.display_name, roles: [] });
      });
      (roles || []).forEach((r: any) => {
        const u = map.get(r.user_id);
        if (u) u.roles.push(r.role);
      });
      setUsers(Array.from(map.values()));
    } catch (e: any) {
      toast.error(e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  };

  const handleAddRole = async () => {
    if (!selectedUserId || !selectedRole) return;
    setAdding(true);
    try {
      const { error } = await supabase.from('user_roles').insert({ user_id: selectedUserId, role: selectedRole });
      if (error) {
        toast.error(error.code === '23505' ? (isRu ? 'Роль уже назначена' : 'Role already assigned') : error.message);
      } else {
        toast.success(isRu ? 'Роль добавлена' : 'Role added');
        setSelectedUserId('');
        await fetchUsersWithRoles();
      }
    } catch (e: any) {
      toast.error(e?.message || 'Error');
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveRole = async (userId: string, role: AppRole) => {
    try {
      const { error } = await supabase.from('user_roles').delete().eq('user_id', userId).eq('role', role);
      if (error) throw error;
      toast.success(isRu ? 'Роль удалена' : 'Role removed');
      fetchUsersWithRoles();
    } catch (e: any) {
      toast.error(e?.message);
    }
  };

  if (authLoading || !rolesLoaded || loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex-1 p-4 sm:p-8 max-w-6xl mx-auto w-full"
    >
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Shield className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold font-display text-foreground">
            {isRu ? 'Панель администратора' : 'Admin Panel'}
          </h1>
        </div>
        <Button variant="ghost" size="icon" onClick={() => navigate('/profile')} className="text-muted-foreground hover:text-foreground" title={isRu ? 'Закрыть' : 'Close'}>
          <X className="h-5 w-5" />
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Add Role Card */}
        <Card className="lg:col-span-1 border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center gap-2 pb-4">
            <UserPlus className="h-5 w-5 text-primary" />
            <CardTitle className="font-display">{isRu ? 'Назначить роль' : 'Assign Role'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{isRu ? 'Пользователь' : 'User'}</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger><SelectValue placeholder={isRu ? 'Выберите пользователя' : 'Select user'} /></SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.user_id} value={u.user_id}>
                      {u.display_name || u.username || u.user_id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{isRu ? 'Роль' : 'Role'}</Label>
              <Select value={selectedRole} onValueChange={(v) => setSelectedRole(v as AppRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="moderator">Moderator</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleAddRole} disabled={!selectedUserId || adding} className="w-full">
              {adding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <UserPlus className="h-4 w-4 mr-2" />}
              {isRu ? 'Добавить роль' : 'Add Role'}
            </Button>
          </CardContent>
        </Card>

        {/* Users List */}
        <Card className="lg:col-span-2 border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center gap-2 pb-4">
            <Users className="h-5 w-5 text-primary" />
            <CardTitle className="font-display">{isRu ? 'Пользователи и роли' : 'Users & Roles'}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{isRu ? 'Пользователь' : 'User'}</TableHead>
                  <TableHead>{isRu ? 'Роли' : 'Roles'}</TableHead>
                  <TableHead className="w-[100px]">{isRu ? 'Действия' : 'Actions'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.user_id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{u.display_name || u.username || (isRu ? 'Без имени' : 'No name')}</p>
                        {u.username && u.display_name && (
                          <p className="text-sm text-muted-foreground">@{u.username}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {u.roles.length === 0 ? (
                          <span className="text-muted-foreground text-sm">{isRu ? 'Нет ролей' : 'No roles'}</span>
                        ) : (
                          u.roles.map((role) => {
                            const Icon = roleIcons[role];
                            return (
                              <Badge key={role} variant="outline" className={cn('flex items-center gap-1', roleColors[role])}>
                                <Icon className="h-3 w-3" />
                                {role}
                              </Badge>
                            );
                          })
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {u.roles.map((role) => (
                        <Button key={role} variant="ghost" size="icon" onClick={() => handleRemoveRole(u.user_id, role)} className="h-8 w-8 text-muted-foreground hover:text-destructive" title={`${isRu ? 'Удалить роль' : 'Remove role'} ${role}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </motion.div>
  );
}
