package com.katay.kttadtor;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Copies a finished export from the app cache into the shared gallery
 * (Movies/ or Music/ under "KT Tadtor") through MediaStore, so no storage
 * permission is needed on Android 10+.
 */
@CapacitorPlugin(name = "KtMedia")
public class KtMediaPlugin extends Plugin {
    private static final String ALBUM = "KT Tadtor";

    @PluginMethod
    public void saveToGallery(PluginCall call) {
        String path = call.getString("path");
        String filename = call.getString("filename");
        String mime = call.getString("mime", "video/mp4");
        if (path == null || filename == null) {
            call.reject("path and filename are required");
            return;
        }
        File source = new File(Uri.parse(path).getPath());
        if (!source.isFile()) {
            call.reject("Export file not found: " + source);
            return;
        }

        boolean isAudio = mime.startsWith("audio/");
        Uri collection = isAudio
                ? MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                : MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        String dir = (isAudio ? Environment.DIRECTORY_MUSIC : Environment.DIRECTORY_MOVIES) + "/" + ALBUM;

        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, filename);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, dir);
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);

        ContentResolver resolver = getContext().getContentResolver();
        Uri item = resolver.insert(collection, values);
        if (item == null) {
            call.reject("MediaStore refused the new entry");
            return;
        }

        try (InputStream in = new FileInputStream(source);
             OutputStream out = resolver.openOutputStream(item)) {
            if (out == null) throw new IllegalStateException("Cannot open gallery output");
            byte[] buf = new byte[1 << 16];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        } catch (Exception e) {
            resolver.delete(item, null, null);
            call.reject("Saving to gallery failed: " + e.getMessage(), e);
            return;
        }

        values.clear();
        values.put(MediaStore.MediaColumns.IS_PENDING, 0);
        resolver.update(item, values, null, null);

        JSObject ret = new JSObject();
        ret.put("uri", item.toString());
        ret.put("relativePath", dir + "/" + filename);
        call.resolve(ret);
    }
}
