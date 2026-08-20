-- Keep the WhatsApp inbox aligned with lead ownership. Supervisors and
-- viewers retain account-wide visibility; sellers only see the conversation
-- belonging to the most recent commercial opportunity for that contact.

CREATE OR REPLACE FUNCTION public.can_access_conversation(
  p_account_id UUID,
  p_contact_id UUID,
  p_write BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth.role() = 'service_role'
    OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_id = p_account_id
        AND (
          p.account_role IN ('owner', 'admin')
          OR (NOT p_write AND p.account_role = 'viewer')
          OR (
            p.account_role = 'agent'
            AND (
              SELECT l.assigned_to_user_id
              FROM public.leads l
              WHERE l.account_id = p_account_id
                AND l.contact_id = p_contact_id
              ORDER BY
                CASE WHEN l.status IN ('new', 'in_progress', 'follow_up') THEN 0 ELSE 1 END,
                l.received_at DESC,
                l.id DESC
              LIMIT 1
            ) = auth.uid()
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.can_access_conversation(UUID, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_conversation(UUID, UUID, BOOLEAN) TO authenticated, service_role;

DROP POLICY IF EXISTS conversations_select ON public.conversations;
DROP POLICY IF EXISTS conversations_insert ON public.conversations;
DROP POLICY IF EXISTS conversations_update ON public.conversations;
DROP POLICY IF EXISTS conversations_delete ON public.conversations;

CREATE POLICY conversations_select ON public.conversations FOR SELECT
  USING (public.can_access_conversation(account_id, contact_id, FALSE));
CREATE POLICY conversations_insert ON public.conversations FOR INSERT
  WITH CHECK (public.can_access_conversation(account_id, contact_id, TRUE));
CREATE POLICY conversations_update ON public.conversations FOR UPDATE
  USING (public.can_access_conversation(account_id, contact_id, TRUE))
  WITH CHECK (public.can_access_conversation(account_id, contact_id, TRUE));
CREATE POLICY conversations_delete ON public.conversations FOR DELETE
  USING (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS messages_select ON public.messages;
DROP POLICY IF EXISTS messages_modify ON public.messages;
CREATE POLICY messages_select ON public.messages FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id
      AND public.can_access_conversation(c.account_id, c.contact_id, FALSE)
  )
);
CREATE POLICY messages_modify ON public.messages FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id
      AND public.can_access_conversation(c.account_id, c.contact_id, TRUE)
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id
      AND public.can_access_conversation(c.account_id, c.contact_id, TRUE)
  )
);

DROP POLICY IF EXISTS "Users see reactions on their conversations" ON public.message_reactions;
DROP POLICY IF EXISTS "Users insert reactions on their conversations" ON public.message_reactions;
DROP POLICY IF EXISTS "Users delete their own agent reactions" ON public.message_reactions;
DROP POLICY IF EXISTS "Users update their own agent reactions" ON public.message_reactions;
DROP POLICY IF EXISTS message_reactions_select ON public.message_reactions;
DROP POLICY IF EXISTS message_reactions_modify ON public.message_reactions;
DROP POLICY IF EXISTS message_reactions_insert ON public.message_reactions;
DROP POLICY IF EXISTS message_reactions_update ON public.message_reactions;
DROP POLICY IF EXISTS message_reactions_delete ON public.message_reactions;

CREATE POLICY message_reactions_select ON public.message_reactions FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = message_reactions.conversation_id
      AND public.can_access_conversation(c.account_id, c.contact_id, FALSE)
  )
);
CREATE POLICY message_reactions_insert ON public.message_reactions FOR INSERT WITH CHECK (
  actor_type = 'agent' AND actor_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = message_reactions.conversation_id
      AND public.can_access_conversation(c.account_id, c.contact_id, TRUE)
  )
);
CREATE POLICY message_reactions_update ON public.message_reactions FOR UPDATE USING (
  actor_type = 'agent' AND actor_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = message_reactions.conversation_id
      AND public.can_access_conversation(c.account_id, c.contact_id, TRUE)
  )
) WITH CHECK (actor_type = 'agent' AND actor_id = auth.uid());
CREATE POLICY message_reactions_delete ON public.message_reactions FOR DELETE USING (
  actor_type = 'agent' AND actor_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = message_reactions.conversation_id
      AND public.can_access_conversation(c.account_id, c.contact_id, TRUE)
  )
);
