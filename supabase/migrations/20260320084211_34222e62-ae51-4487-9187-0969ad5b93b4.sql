-- Merge phantom "он" into Филипп Филиппович
-- 1. Update segment speaker
UPDATE scene_segments SET speaker = 'Филипп Филиппович'
WHERE speaker = 'он' AND scene_id IN (
  SELECT bs.id FROM book_scenes bs
  JOIN book_chapters ch ON ch.id = bs.chapter_id
  WHERE ch.book_id = 'ef691e54-2ce7-448e-b38b-455ccfb5acf2'
);

-- 2. Move character_appearances from phantom to real character
-- First check if real character already has appearance in that scene
DO $$
DECLARE
  phantom_id UUID := '7a8cac5a-0999-4492-b09a-b1f0773bd2aa';
  real_id UUID := 'afdfadaf-99f4-45e7-add5-57c9c68c5a58';
  app RECORD;
BEGIN
  FOR app IN SELECT * FROM character_appearances WHERE character_id = phantom_id LOOP
    -- Try to merge into existing appearance
    UPDATE character_appearances
    SET segment_ids = segment_ids || app.segment_ids
    WHERE character_id = real_id AND scene_id = app.scene_id;
    
    IF NOT FOUND THEN
      -- No existing appearance, just reassign
      UPDATE character_appearances SET character_id = real_id WHERE id = app.id;
    ELSE
      -- Delete the phantom's appearance since we merged
      DELETE FROM character_appearances WHERE id = app.id;
    END IF;
  END LOOP;
END $$;

-- 3. Delete phantom character
DELETE FROM book_characters WHERE id = '7a8cac5a-0999-4492-b09a-b1f0773bd2aa';
