package kr.saltteul.app.widget;

/** 2x2 (resizable): every pantry item, low and expiring first, each with a −1 button. */
public class PantryWidget extends BaseWidgetProvider {
    @Override
    protected String kind() {
        return WidgetLogic.KIND_PANTRY;
    }
}
