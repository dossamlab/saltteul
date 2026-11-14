package kr.saltteul.app.widget;

/** 4x1: today's weather and the one thing to bring now (design 2026-11-14 section 1.2). */
public class EssentialsWidget extends BaseWidgetProvider {
    @Override
    protected String kind() {
        return WidgetLogic.KIND_ESSENTIALS;
    }
}
