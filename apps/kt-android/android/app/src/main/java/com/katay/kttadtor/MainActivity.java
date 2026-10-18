package com.katay.kttadtor;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KtMediaPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
