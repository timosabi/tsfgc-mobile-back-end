import { supabaseService } from "../integrations/supabase/supabaseClient.js";

export default class UserService {
  async deleteUser(userId: string) {
    const { error } = await supabaseService.auth.admin.deleteUser(userId || "");

    if (error) throw new Error(error.message);
  }
}
